import { Body, Controller, Delete, Get, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { vendasPorConsultorSql } from '../../common/reports/sales-base';
import { SURVEY_SCALE_MAX, normalizeRankingWeights, rankingScores, type SurveyScale } from '@atendo/shared';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { NO_NUMBER } from '../auth/company-scope';
import { ReportCompany, reportScope } from '../../common/reports/report-scope';
import { ReportLoadService, assertReportRange } from '../../common/reports/report-load.service';
import { BillingModule } from '../billing/billing.module';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';

/**
 * DSL de relatório: parâmetros escolhidos na UI -> query controlada -> série para gráfico.
 * Nunca recebe SQL do usuário; só dimensões/métricas de uma lista fechada.
 */
export const ReportDefinition = z.object({
  metric: z.enum(['conversations', 'messages_in', 'messages_out', 'avg_first_response_min', 'closed', 'revenue', 'won', 'lost', 'win_rate']),
  groupBy: z.enum(['day', 'week', 'month', 'tag', 'status', 'number', 'company', 'agent', 'origin', 'campaign', 'reason']),
  from: z.coerce.date(),
  to: z.coerce.date(),
  filters: z
    .object({
      tagIds: z.array(z.string().uuid()).optional(),
      status: z.enum(['waiting', 'in_progress', 'closed']).optional(),
      numberId: z.string().uuid().optional(),
      origin: z.enum(['organic', 'ad', 'post', 'link']).optional(),
      /** consultor: em conversa, quem está com ela; em venda/encerramento, quem encerrou */
      agentId: z.string().uuid().optional(),
    })
    .default({}),
  chart: z.enum(['bar', 'line', 'pie']).default('bar'),
});
export type ReportDefinition = z.infer<typeof ReportDefinition>;

/** filtros globais da tela de Relatórios: `tagIds` vem separado por vírgula na query string */
const OverviewQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  tagIds: z.string().optional().transform((v) => v?.split(',').filter(Boolean)).pipe(z.array(z.string().uuid()).max(50).optional()),
  agentId: z.string().uuid().optional(),
  /** empresa escolhida na página (`all` = todas as que a pessoa opera); ausente = seletor do menu */
  companyId: ReportCompany,
});
/** Linha do comparativo por empresa (`GET /reports/companies`). */
type KpisDoEscopo = { conversations: number; closed: number; waitingNow: number; avgFirstResponseMin: number | null; won: number; lost: number; revenue: number; avgTicket: number | null; winRate: number | null };

/** `numberIds` = escopo de números da pessoa/empresa selecionada (`escopoDe`); ausente = todos do cliente */
type Filtro = { tagIds?: string[]; agentId?: string; numberIds?: string[] };

/**
 * Escopo do relatório: a empresa selecionada no painel (header `x-company-id`) mais a restrição de
 * números da pessoa, com os números excluídos da empresa (`reportScope`). Sem isto o relatório
 * somava todas as empresas do cliente, com qualquer empresa selecionada.
 */
/** a coluna (id de conversa) é de uma conversa dos números do escopo */
const conversaNoEscopo = (col: Prisma.Sql, numberIds: string[]) => Prisma.sql`${col} in (select cs.id from conversations cs where cs."numberId" in (${Prisma.join(numberIds)}))`;

/**
 * Encerramento "do consultor": ele encerrou, ou a automação encerrou enquanto a conversa era
 * dele (`targetId` = dono, gravado no encerramento automático). Sem isto, quem usa fluxo que
 * fecha a conversa via "Mudar status" sumia do próprio filtro. O ranking continua só pelo ator.
 */
/** Conversa de contato isento de ticket não entra em relatório (docs/contatos-isentos.md). */
const semIsento = (conversationId: Prisma.Sql) => Prisma.sql`not exists (select 1 from conversations cx where cx.id = ${conversationId} and cx."ticketExempt")`;
const doConsultor = (agentId: string) => Prisma.sql`(e."actorId" = ${agentId} or (e."actorId" is null and e."targetId" = ${agentId}))`;

const SalesDetailsQuery = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  userId: z.string().uuid().optional(),
  tagIds: z.string().optional().transform((v) => v?.split(',').filter(Boolean)).pipe(z.array(z.string().uuid()).max(50).optional()),
  contactId: z.string().uuid().optional(),
  phone: z.string().max(40).optional(),
  customerName: z.string().max(120).optional(),
  search: z.string().trim().max(120).optional().transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: ReportCompany,
});

const AttendancesQuery = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  outcome: z.enum(['won', 'lost', 'none']).optional(),
  /** tags escolhidas NESTE encerramento (não as que a conversa tem hoje) */
  tagIds: z.string().optional().transform((v) => v?.split(',').filter(Boolean)).pipe(z.array(z.string().uuid()).max(50).optional()),
  /** motivo do encerramento (lista `close_reasons`) */
  closeReasonId: z.string().uuid().optional(),
  /** encerramento antigo sem motivo cadastrado: casa o texto gravado (o card "por motivo" mostra esses rótulos) */
  reason: z.string().trim().max(120).optional().transform((v) => v || undefined),
  userId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional().transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: ReportCompany,
});

/** "5511999998888" → "+55 11 99999-8888". Fora do padrão BR devolve só com o "+". */
/**
 * O atendimento que começou em `desde` terminou num encerramento interno? É o PRIMEIRO
 * encerramento da conversa a partir do início — o atendimento ainda aberto (sem encerramento)
 * conta normalmente. Tira o atendimento interno do volume e do TMR, além do próprio encerramento.
 */
function encerradoInterno(conversationId: Prisma.Sql, desde: Prisma.Sql) {
  return Prisma.sql`coalesce((select ce."ignoreInReports" from conversation_events ce
    where ce."conversationId" = ${conversationId} and ce.type = 'closed' and ce."createdAt" >= ${desde}
    order by ce."createdAt" limit 1), false)`;
}

function formatPhone(phone: string) {
  const d = phone.split('@')[0].split(':')[0].replace(/\D/g, '');
  const br = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${d}`;
}

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('reports.view')
class ReportsController {
  constructor(private readonly prisma: PrismaService, private readonly load: ReportLoadService) {}

  @Post('run')
  async run(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const def = ReportDefinition.parse(body);
    assertReportRange(def.from, def.to);
    // a empresa vem ao lado da definição: relatório salvo não fica preso a uma empresa
    const nums = await reportScope(this.prisma, u, ReportCompany.parse((body as { companyId?: unknown } | null)?.companyId ?? undefined));
    const series = await this.load.cached(ReportLoadService.key(u.tenantId, 'run', { d: JSON.stringify(def), nums: nums?.join(',') }), () => this.load.run(() => this.query(u.tenantId, def, nums)));
    return { definition: def, series };
  }

  /**
   * Visão pronta do período: indicadores + séries mais usadas, numa chamada só.
   * É o que a tela de Relatórios abre por padrão.
   */
  /**
   * Filtros de tag e consultor valem para a tela inteira. Período: o front manda o início do dia
   * local (ISO com hora) — "Hoje" em data pura seria meia-noite UTC, três horas fora no Brasil.
   */
  @Get('overview')
  async overview(@CurrentUser() u: AuthUser, @Query() q: Record<string, string | undefined>) {
    const f = OverviewQuery.parse(q);
    const to = f.to ?? new Date(Date.now() + 86_400_000);
    const from = f.from ?? new Date(Date.now() - 29 * 86_400_000);
    const filtro: Filtro = { tagIds: f.tagIds?.length ? f.tagIds : undefined, agentId: f.agentId, numberIds: await reportScope(this.prisma, u, f.companyId) };
    assertReportRange(from, to);
    return this.load.cached(ReportLoadService.key(u.tenantId, 'overview', { from, to, tags: filtro.tagIds?.join(','), agent: filtro.agentId, nums: filtro.numberIds?.join(',') }), () => this.overviewData(u.tenantId, from, to, filtro));
  }

  /** Corpo da visão pronta: ~20 consultas, todas pelo limite de concorrência (`ReportLoadService`). */
  private async overviewData(t: string, from: Date, to: Date, filtro: Filtro) {
    const base = { from, to, filters: { tagIds: filtro.tagIds, agentId: filtro.agentId }, chart: 'bar' as const };
    const nums = filtro.numberIds;
    // conversa: tem a tag / está com o consultor
    const conv: Prisma.ConversationWhereInput = {
      tenantId: t,
      // contato isento de ticket não é atendimento (docs/contatos-isentos.md)
      ticketExempt: false,
      ...(filtro.tagIds && { tags: { some: { tagId: { in: filtro.tagIds } } } }),
      ...(filtro.agentId && { assigneeId: filtro.agentId }),
      ...(nums && { numberId: { in: nums } }),
    };
    // encerramento: tag escolhida nele (ou na conversa) / quem encerrou
    const fechou: Prisma.ConversationEventWhereInput = {
      tenantId: t,
      type: 'closed',
      // atendimento interno não entra em relatório nenhum (docs/06-modelo-de-dados.md#encerramento-interno)
      ignoreInReports: false,
      createdAt: { gte: from, lt: to },
      ...(filtro.tagIds && { OR: [{ tagIds: { hasSome: filtro.tagIds } }, { conversation: { tags: { some: { tagId: { in: filtro.tagIds } } } } }] }),
      ...(filtro.agentId && { AND: [{ OR: [{ actorId: filtro.agentId }, { actorId: null, targetId: filtro.agentId }] }] }),
      conversation: { ticketExempt: false, ...(nums && { numberId: { in: nums } }) },
    };
    const [closed, waitingNow, inProgressNow, msgsIn, msgsOut, firstResp, byDay, byAgent, byOrigin, byCampaign, byTag, byStatus, lost] = await this.load.all([
      // atendimentos ENCERRADOS no período (um encerramento = um atendimento), não conversas
      // criadas no período que por acaso estão fechadas agora
      () => this.prisma.conversationEvent.count({ where: fechou }),
      () => this.prisma.conversation.count({ where: { ...conv, status: 'waiting' } }),
      () => this.prisma.conversation.count({ where: { ...conv, status: 'in_progress' } }),
      () => this.prisma.message.count({ where: { direction: 'in', createdAt: { gte: from, lt: to }, conversation: conv } }),
      () => this.prisma.message.count({ where: { direction: 'out', internal: false, createdAt: { gte: from, lt: to }, conversation: conv } }),
      () => this.query(t, { ...base, metric: 'avg_first_response_min', groupBy: 'status' }, nums),
      () => this.query(t, { ...base, metric: 'conversations', groupBy: 'day' }, nums),
      // quem encerrou no período (um encerramento = um atendimento); pelo dono ATUAL da conversa
      // ficavam de fora os atendimentos já fechados e os de quem saiu da fila
      () => this.query(t, { ...base, metric: 'closed', groupBy: 'agent' }, nums),
      () => this.query(t, { ...base, metric: 'conversations', groupBy: 'origin' }, nums),
      () => this.query(t, { ...base, metric: 'conversations', groupBy: 'campaign' }, nums),
      () => this.query(t, { ...base, metric: 'conversations', groupBy: 'tag' }, nums),
      () => this.query(t, { ...base, metric: 'conversations', groupBy: 'status' }, nums),
      () => this.prisma.conversationEvent.count({ where: { ...fechou, outcome: 'lost' } }),
    ]);
    // vendas pela régua da meta/ranking ("Comprou" + orçamento pago sem encerramento − estornos)
    const vendas = (await this.load.run(() => this.prisma.$queryRaw<{ userId: string; won: number; revenue: number }[]>(vendasPorConsultorSql(t, from, to, filtro.tagIds ? this.eventoTemTag(filtro.tagIds) : undefined, nums))))
      .filter((v) => !filtro.agentId || v.userId === filtro.agentId);
    const wonTotal = vendas.reduce((a, v) => a + Number(v.won), 0);
    const revenueTotal = Math.round(vendas.reduce((a, v) => a + Number(v.revenue) * 100, 0)) / 100;
    const respVals = firstResp.filter((r) => r.value > 0).map((r) => r.value);
    // atendimentos INICIADOS no período (conversa nova + reaberta): cada um cai em um dia só
    const total = byDay.reduce((a, r) => a + r.value, 0);
    const [sales, lostReasons] = await Promise.all([this.sales(t, from, to, filtro), this.load.run(() => this.lostReasons(t, from, to, filtro))]);
    return {
      period: { from, to },
      kpis: {
        conversations: total,
        closed,
        closeRate: total ? closed / total : 0,
        waitingNow,
        inProgressNow,
        messagesIn: msgsIn,
        messagesOut: msgsOut,
        avgFirstResponseMin: respVals.length ? respVals.reduce((a, b) => a + b, 0) / respVals.length : null,
        won: wonTotal,
        lost,
        revenue: revenueTotal,
        winRate: wonTotal + lost > 0 ? wonTotal / (wonTotal + lost) : null,
      },
      sales,
      lostReasons,
      series: { byDay, byAgent, byOrigin, byCampaign: byCampaign.filter((c) => c.label !== '(orgânico)'), byTag: byTag.filter((c) => c.label !== '(sem tag)').sort((a, b) => b.value - a.value).slice(0, 8), byStatus },
    };
  }

  /**
   * Comparativo por empresa: os indicadores principais lado a lado, um por empresa que a pessoa
   * opera (docs/empresas.md#relatórios). Cada linha usa o mesmo escopo de números do seletor, então
   * bate com o que a tela mostra ao escolher aquela empresa. "(sem empresa)" = números fora de
   * qualquer empresa, só para quem enxerga o cliente inteiro.
   */
  @Get('companies')
  async byCompany(@CurrentUser() u: AuthUser, @Query() q: Record<string, string | undefined>) {
    const f = OverviewQuery.parse(q);
    const to = f.to ?? new Date(Date.now() + 86_400_000);
    const from = f.from ?? new Date(Date.now() - 29 * 86_400_000);
    assertReportRange(from, to);
    const filtro: Filtro = { tagIds: f.tagIds?.length ? f.tagIds : undefined, agentId: f.agentId };
    return this.load.cached(
      ReportLoadService.key(u.tenantId, 'companies', { from, to, tags: filtro.tagIds?.join(','), agent: filtro.agentId, own: u.ownNumberIds?.join(','), cos: u.companyRestricted ? u.companyIds?.join(',') : 'todas' }),
      async () => {
        // ativas que a pessoa opera + removidas que ainda têm histórico (só para quem enxerga todas)
        const empresas = await this.prisma.company.findMany({ where: this.empresasDoFiltro(u), select: { id: true, name: true, deletedAt: true }, orderBy: [{ deletedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }] });
        const grupos: { companyId: string | null; name: string; removed: boolean; numberIds: string[] }[] = [];
        for (const c of empresas) grupos.push({ companyId: c.id, name: c.name, removed: !!c.deletedAt, numberIds: (await reportScope(this.prisma, u, c.id)) ?? [] });
        if (!u.companyRestricted && !u.ownNumberIds?.length && empresas.length) {
          const soltos = await this.prisma.whatsAppNumber.findMany({ where: { tenantId: u.tenantId, companyId: null }, select: { id: true } });
          if (soltos.length) grupos.push({ companyId: null, name: '(sem empresa)', removed: false, numberIds: soltos.map((n) => n.id) });
        }
        const rows: ({ companyId: string | null; name: string; removed: boolean } & KpisDoEscopo)[] = [];
        // uma empresa por vez: cada uma já dispara várias consultas pelo limite de concorrência
        for (const g of grupos) rows.push({ companyId: g.companyId, name: g.name, removed: g.removed, ...(await this.kpisDoEscopo(u.tenantId, from, to, { ...filtro, numberIds: g.numberIds.length ? g.numberIds : [NO_NUMBER] })) });
        return { period: { from, to }, rows };
      },
    );
  }

  /**
   * Empresas do filtro da página de relatórios: as ativas que a pessoa opera e, para quem enxerga
   * todas, as removidas que ainda têm histórico (docs/empresas.md#remover).
   */
  @Get('companies/options')
  async companyOptions(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.company.findMany({ where: this.empresasDoFiltro(u), select: { id: true, name: true, deletedAt: true }, orderBy: [{ deletedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }] });
    return rows.map((c) => ({ id: c.id, name: c.name, removed: !!c.deletedAt }));
  }

  private empresasDoFiltro(u: AuthUser): Prisma.CompanyWhereInput {
    return {
      tenantId: u.tenantId,
      OR: [
        { deletedAt: null, ...(u.companyRestricted && { id: { in: u.companyIds ?? [] } }) },
        ...(u.companyRestricted ? [] : [{ deletedAt: { not: null }, numbers: { some: {} } }]),
      ],
    };
  }

  /** Indicadores do comparativo por empresa — a mesma régua dos cartões da visão pronta. */
  private async kpisDoEscopo(t: string, from: Date, to: Date, filtro: Filtro & { numberIds: string[] }): Promise<KpisDoEscopo> {
    const base = { from, to, filters: { tagIds: filtro.tagIds, agentId: filtro.agentId }, chart: 'bar' as const };
    const nums = filtro.numberIds;
    const fechou: Prisma.ConversationEventWhereInput = {
      tenantId: t,
      type: 'closed',
      ignoreInReports: false,
      createdAt: { gte: from, lt: to },
      conversation: { numberId: { in: nums }, ticketExempt: false },
      ...(filtro.tagIds && { OR: [{ tagIds: { hasSome: filtro.tagIds } }, { conversation: { tags: { some: { tagId: { in: filtro.tagIds } } } } }] }),
      ...(filtro.agentId && { AND: [{ OR: [{ actorId: filtro.agentId }, { actorId: null, targetId: filtro.agentId }] }] }),
    };
    const [iniciados, closed, lost, waitingNow, firstResp, vendas] = await this.load.all([
      () => this.query(t, { ...base, metric: 'conversations', groupBy: 'month' }, nums),
      () => this.prisma.conversationEvent.count({ where: fechou }),
      () => this.prisma.conversationEvent.count({ where: { ...fechou, outcome: 'lost' } }),
      () => this.prisma.conversation.count({ where: { tenantId: t, numberId: { in: nums }, ticketExempt: false, status: 'waiting', ...(filtro.agentId && { assigneeId: filtro.agentId }) } }),
      () => this.query(t, { ...base, metric: 'avg_first_response_min', groupBy: 'status' }, nums),
      () => this.prisma.$queryRaw<{ userId: string; won: number; revenue: number }[]>(vendasPorConsultorSql(t, from, to, filtro.tagIds ? this.eventoTemTag(filtro.tagIds) : undefined, nums)),
    ]);
    const v = vendas.filter((x) => !filtro.agentId || x.userId === filtro.agentId);
    const won = v.reduce((a, x) => a + Number(x.won), 0);
    const revenue = Math.round(v.reduce((a, x) => a + Number(x.revenue) * 100, 0)) / 100;
    const resp = firstResp.filter((r) => r.value > 0).map((r) => r.value);
    return {
      conversations: iniciados.reduce((a, r) => a + r.value, 0),
      closed,
      waitingNow,
      avgFirstResponseMin: resp.length ? resp.reduce((a, b) => a + b, 0) / resp.length : null,
      won,
      lost,
      revenue,
      avgTicket: won ? revenue / won : null,
      winRate: won + lost > 0 ? won / (won + lost) : null,
    };
  }

  /**
   * Auditoria: cada encerramento do período (um atendimento), com resultado, quem encerrou e as
   * tags escolhidas nele. Sai do histórico (`conversation_events`) — a conversa só guarda o
   * atendimento atual. `startedAt` = encerramento anterior da mesma conversa (null = desde o
   * começo): é a janela de mensagens do atendimento (`GET /conversations/:id/messages?after&until`).
   * `endDate` exclusivo, como no resto dos relatórios.
   */
  @Get('attendances')
  async attendances(@CurrentUser() u: AuthUser, @Query() q: Record<string, string | undefined>) {
    const f = AttendancesQuery.parse(q);
    const to = f.endDate ?? new Date(Date.now() + 86_400_000);
    const from = f.startDate ?? new Date(to.getTime() - 30 * 86_400_000);
    assertReportRange(from, to);
    const like = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = (v: string) => v.replace(/\D/g, '');
    const conds: Prisma.Sql[] = [Prisma.sql`e."tenantId" = ${u.tenantId}`, Prisma.sql`e.type = 'closed'`, Prisma.sql`not e."ignoreInReports"`, Prisma.sql`not cv."ticketExempt"`, Prisma.sql`e."createdAt" >= ${from}`, Prisma.sql`e."createdAt" < ${to}`];
    if (f.outcome) conds.push(Prisma.sql`e.outcome = ${f.outcome}::"ConversationOutcome"`);
    if (f.tagIds?.length) conds.push(Prisma.sql`(e."tagIds" || e."tagSnapshot") && ARRAY[${Prisma.join(f.tagIds)}]::text[]`);
    if (f.closeReasonId) conds.push(Prisma.sql`e."closeReasonId" = ${f.closeReasonId}`);
    if (f.reason) conds.push(Prisma.sql`e."closeReasonId" is null and trim(regexp_replace(coalesce(e.reason, ''), '(\\s*·\\s*)?encerrado em massa$', '')) = ${f.reason}`);
    if (f.userId) conds.push(doConsultor(f.userId));
    const nums = await reportScope(this.prisma, u, f.companyId);
    if (nums) conds.push(Prisma.sql`cv."numberId" in (${Prisma.join(nums)})`);
    if (f.search) {
      const ors = [Prisma.sql`c.name ilike ${like(f.search)}`];
      if (digits(f.search).length >= 3) ors.push(Prisma.sql`c.phone like ${like(digits(f.search))}`);
      conds.push(Prisma.sql`(${Prisma.join(ors, ' or ')})`);
    }
    const where = Prisma.join(conds, ' and ');
    const from_ = Prisma.sql`from conversation_events e join conversations cv on cv.id = e."conversationId" join contacts c on c.id = cv."contactId" left join users usr on usr.id = e."actorId"`;

    // a página primeiro (só ids, pelo índice de tenant/tipo/data) e os laterais caros — início do
    // atendimento e contagem de mensagens — só para as linhas da página, não para o período inteiro
    const [rows, resumo, agents] = await this.load.all([
      () => this.prisma.$queryRaw<{ id: string; closedAt: Date; conversationId: string; outcome: string | null; value: number | null; reason: string | null; tagIds: string[] | null; tagSnapshot: string[] | null; closeReasonId: string | null; reasonName: string | null; reasonColor: string | null; stageTagId: string | null; contactId: string; contactName: string | null; phone: string; userId: string | null; userName: string | null; ownerId: string | null; ownerName: string | null; startedAt: Date | null; messages: number }[]>(Prisma.sql`
        with pg as (
          select e.id ${from_} where ${where}
          order by e."createdAt" desc
          limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}
        )
        select e.id, e."createdAt" as "closedAt", e."conversationId", e.outcome::text as outcome, e."outcomeValue"::float as value, e.reason, e."tagIds", e."tagSnapshot",
               e."closeReasonId", cr.name as "reasonName", cr.color as "reasonColor", e."stageTagId",
               c.id as "contactId", c.name as "contactName", c.phone, e."actorId" as "userId", usr.name as "userName",
               case when e."actorId" is null then e."targetId" end as "ownerId", own.name as "ownerName",
               ini."startedAt",
               (select count(*)::int from messages m where m."conversationId" = e."conversationId" and not m.imported and m."createdAt" <= e."createdAt" and (ini."startedAt" is null or m."createdAt" > ini."startedAt")) as messages
        from pg
        join conversation_events e on e.id = pg.id
        join conversations cv on cv.id = e."conversationId" join contacts c on c.id = cv."contactId" left join users usr on usr.id = e."actorId"
        left join users own on own.id = e."targetId" and e."actorId" is null
        left join close_reasons cr on cr.id = e."closeReasonId"
        left join lateral (select max(p."createdAt") as "startedAt" from conversation_events p where p."conversationId" = e."conversationId" and p.type = 'closed' and p."createdAt" < e."createdAt") ini on true
        order by e."createdAt" desc
      `),
      () => this.prisma.$queryRaw<{ count: number; won: number; lost: number }[]>(Prisma.sql`
        select count(*)::int as count, count(*) filter (where e.outcome = 'won')::int as won, count(*) filter (where e.outcome = 'lost')::int as lost
        ${from_} where ${where}
      `),
      () => this.prisma.user.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    // tags dos encerramentos da página (excluída depois some do nome, mas o evento continua)
    const ids = [...new Set(rows.flatMap((r) => [...(r.tagIds ?? []), ...(r.tagSnapshot ?? []), ...(r.stageTagId ? [r.stageTagId] : [])]))];
    const tags = ids.length ? await this.prisma.tag.findMany({ where: { tenantId: u.tenantId, id: { in: ids } }, select: { id: true, name: true, color: true } }) : [];
    const tagPorId = new Map(tags.map((t) => [t.id, t]));
    const r0 = resumo[0];
    return {
      period: { from, to },
      page: f.page,
      pageSize: f.pageSize,
      total: Number(r0?.count ?? 0),
      summary: { count: Number(r0?.count ?? 0), won: Number(r0?.won ?? 0), lost: Number(r0?.lost ?? 0) },
      agents,
      rows: rows.map((r) => ({
        id: r.id,
        closedAt: r.closedAt,
        startedAt: r.startedAt,
        conversationId: r.conversationId,
        outcome: r.outcome as 'won' | 'lost' | 'none' | null,
        value: r.value != null ? Number(r.value) : null,
        // tags do atendimento (transitórias, congeladas no encerramento) + as escolhidas nele
        tags: [...new Set([...(r.tagSnapshot ?? []), ...(r.tagIds ?? [])])].filter((id) => id !== r.stageTagId).map((id) => tagPorId.get(id) ?? { id, name: '(tag excluída)', color: '#94a3b8' }),
        /** motivo do encerramento; sem cadastro (antigo), o texto gravado */
        closeReason: r.closeReasonId ? { id: r.closeReasonId, name: r.reasonName ?? '(motivo excluído)', color: r.reasonColor ?? '#94a3b8' } : null,
        reason: r.closeReasonId || r.reason === 'automação' ? null : r.reason?.replace(/(\s*·\s*)?encerrado em massa$/, '').trim() || null,
        /** etapa do Kanban em que o atendimento estava */
        stage: r.stageTagId ? (tagPorId.get(r.stageTagId) ?? { id: r.stageTagId, name: '(tag excluída)', color: '#94a3b8' }) : null,
        messages: Number(r.messages),
        contact: { id: r.contactId, name: r.contactName, phone: r.phone, phoneFormatted: formatPhone(r.phone) },
        user: r.userId ? { id: r.userId, name: r.userName } : null,
        /** encerrado pela automação: de quem era a conversa (o filtro de consultor conta para ele) */
        owner: !r.userId && r.ownerId ? { id: r.ownerId, name: r.ownerName } : null,
      })),
    };
  }

  /**
   * Detalhamento de vendas (tabela `sales`): lista paginada + resumo do filtro ativo.
   * `endDate` é exclusivo, como no resto dos relatórios. `search` casa nome do cliente,
   * número (só dígitos) ou produto — no texto livre (`products`) e na descrição dos `items`.
   */
  @Get('sales/details')
  async salesDetails(@CurrentUser() u: AuthUser, @Query() q: Record<string, string | undefined>) {
    const f = SalesDetailsQuery.parse(q);
    const to = f.endDate ?? new Date(Date.now() + 86_400_000);
    const from = f.startDate ?? new Date(to.getTime() - 30 * 86_400_000);
    assertReportRange(from, to);
    // escapa curingas do ILIKE: o termo continua parametrizado, isto só evita "%" casar tudo
    const like = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = (v: string) => v.replace(/\D/g, '');
    // itens gravados como array JSON; venda em texto livre tem `items` nulo
    const itensDe = Prisma.sql`jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end)`;
    const produtoCasa = (t: string) => Prisma.sql`(s.products ilike ${like(t)} or exists (select 1 from ${itensDe} i where i->>'description' ilike ${like(t)}))`;

    // estornada sai do faturamento (a linha fica no banco, para auditoria)
    const conds: Prisma.Sql[] = [Prisma.sql`s."tenantId" = ${u.tenantId}`, Prisma.sql`s."closedAt" >= ${from}`, Prisma.sql`s."closedAt" < ${to}`, Prisma.sql`s."refundedAt" is null`];
    if (f.userId) conds.push(Prisma.sql`s."userId" = ${f.userId}`);
    if (f.tagIds?.length) conds.push(this.vendaTemTag(f.tagIds));
    if (f.contactId) conds.push(Prisma.sql`s."contactId" = ${f.contactId}`);
    if (f.phone && digits(f.phone)) conds.push(Prisma.sql`c.phone like ${like(digits(f.phone))}`);
    if (f.customerName) conds.push(Prisma.sql`c.name ilike ${like(f.customerName)}`);
    const nums = await reportScope(this.prisma, u, f.companyId);
    if (nums) conds.push(conversaNoEscopo(Prisma.sql`s."conversationId"`, nums));
    if (f.search) {
      const ors = [Prisma.sql`c.name ilike ${like(f.search)}`, produtoCasa(f.search)];
      if (digits(f.search).length >= 3) ors.push(Prisma.sql`c.phone like ${like(digits(f.search))}`);
      conds.push(Prisma.sql`(${Prisma.join(ors, ' or ')})`);
    }
    const where = Prisma.join(conds, ' and ');
    const from_ = Prisma.sql`from sales s join contacts c on c.id = s."contactId" left join users usr on usr.id = s."userId"`;

    const [rows, resumo, agents] = await this.load.all([
      () => this.prisma.$queryRaw<{ id: string; closedAt: Date; amount: number; products: string | null; items: unknown; notes: string | null; conversationId: string; contactId: string; contactName: string | null; phone: string; userId: string | null; userName: string | null }[]>(Prisma.sql`
        select s.id, s."closedAt", s.amount::float as amount, s.products, s.items, s.notes, s."conversationId",
               c.id as "contactId", c.name as "contactName", c.phone, s."userId", usr.name as "userName"
        ${from_} where ${where}
        order by s."closedAt" desc
        limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}
      `),
      () => this.prisma.$queryRaw<{ count: number; revenue: number | null; items: number | null }[]>(Prisma.sql`
        select count(*)::int as count, sum(s.amount)::float as revenue,
               -- venda em texto livre conta como 1 produto
               sum(case when jsonb_typeof(s.items) = 'array' then jsonb_array_length(s.items) else 1 end)::int as items
        ${from_} where ${where}
      `),
      // atendentes do tenant para o filtro (inclui quem não vendeu, para o dropdown não "sumir" gente)
      () => this.prisma.user.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const count = Number(resumo[0]?.count ?? 0);
    const revenue = Number(resumo[0]?.revenue ?? 0);
    return {
      period: { from, to },
      page: f.page,
      pageSize: f.pageSize,
      total: count,
      summary: { count, revenue, avgTicket: count ? revenue / count : null, itemsSold: Number(resumo[0]?.items ?? 0) },
      agents,
      rows: rows.map((r) => ({
        id: r.id,
        closedAt: r.closedAt,
        amount: Number(r.amount),
        conversationId: r.conversationId,
        contact: { id: r.contactId, name: r.contactName, phone: r.phone, phoneFormatted: formatPhone(r.phone) },
        user: r.userId ? { id: r.userId, name: r.userName } : null,
        // texto livre vira um item só, para a UI listar do mesmo jeito
        items: Array.isArray(r.items)
          ? (r.items as { description?: unknown; value?: unknown }[]).map((i) => ({ description: String(i.description ?? ''), value: Number(i.value ?? 0) }))
          : [{ description: r.products ?? '(sem descrição)', value: Number(r.amount) }],
        notes: r.notes,
      })),
    };
  }

  /**
   * Ranking de consultores no período: encerramentos (um evento `closed` = um atendimento
   * concluído) por quem encerrou, vendas (`outcome = won`), conversão = vendas ÷ concluídos e
   * TMA = média do início do atendimento (reabertura/encerramento anterior; sem nenhum, criação
   * da conversa) até o encerramento. Encerramento do sistema (sem ator) e interno ficam de fora.
   * `tagIds` = tag do atendimento (escolhida no encerramento, retrato dele ou atual da conversa).
   */
  @Get('ranking-consultants')
  @UseGuards(FeatureGuard)
  @RequireFeature('consultant_ranking')
  async rankingConsultants(@CurrentUser() u: AuthUser, @Query() q: Record<string, string | undefined>) {
    const f = OverviewQuery.parse(q);
    const to = f.to ?? new Date(Date.now() + 86_400_000);
    const from = f.from ?? new Date(Date.now() - 29 * 86_400_000);
    assertReportRange(from, to);
    // pesos entram na chave do cache: mudou o peso, a próxima leitura já reordena
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId: u.tenantId }, select: { rankingWeights: true } });
    const weights = normalizeRankingWeights(s?.rankingWeights);
    const nums = await reportScope(this.prisma, u, f.companyId);
    return this.load.cached(ReportLoadService.key(u.tenantId, 'ranking', { from, to, tags: f.tagIds?.join(','), w: JSON.stringify(weights), nums: nums?.join(',') }), () => this.rankingData(u.tenantId, from, to, f.tagIds, weights, nums));
  }

  private async rankingData(tenantId: string, from: Date, to: Date, tagIds?: string[], weights = normalizeRankingWeights(null), nums?: string[]) {
    const f = { tagIds };
    const conds = [Prisma.sql`e."tenantId" = ${tenantId}`, Prisma.sql`e.type = 'closed'`, Prisma.sql`not e."ignoreInReports"`, Prisma.sql`e."actorId" is not null`, Prisma.sql`not c."ticketExempt"`, Prisma.sql`e."createdAt" >= ${from}`, Prisma.sql`e."createdAt" < ${to}`];
    if (f.tagIds?.length) conds.push(this.eventoTemTag(f.tagIds));
    if (nums) conds.push(Prisma.sql`c."numberId" in (${Prisma.join(nums)})`);
    const rows = await this.load.run(() => this.prisma.$queryRaw<{ userId: string; name: string | null; closed: number; won: number; revenue: number | null; tmaMin: number | null }[]>(Prisma.sql`
      select e."actorId" as "userId", usr.name,
             count(*)::int as closed,
             count(*) filter (where e.outcome = 'won')::int as won,
             sum(e."outcomeValue") filter (where e.outcome = 'won')::float as revenue,
             avg(extract(epoch from (e."createdAt" - coalesce(ini.em, c."createdAt"))) / 60)::float as "tmaMin"
      from conversation_events e
      join conversations c on c.id = e."conversationId"
      left join users usr on usr.id = e."actorId"
      left join lateral (select max(p."createdAt") as em from conversation_events p
        where p."conversationId" = e."conversationId" and p.type in ('closed', 'reopened') and p."createdAt" < e."createdAt") ini on true
      where ${Prisma.join(conds, ' and ')}
      group by 1, 2
    `));
    // satisfação (pergunta principal da pesquisa) por consultor no período. Escalas não se
    // misturam numa média: vale a mais respondida no período (docs/pesquisa-de-satisfacao.md)
    const notas = await this.load.run(() => this.prisma.$queryRaw<{ agentId: string; scale: string; answered: number; avg: number | null; promoters: number; detractors: number }[]>(Prisma.sql`
      select "agentId", scale, count(*)::int as answered, avg(score)::float as avg,
             count(*) filter (where score >= 9)::int as promoters, count(*) filter (where score <= 6)::int as detractors
      from survey_responses
      where "tenantId" = ${tenantId} and "sentAt" >= ${from} and "sentAt" < ${to} and score is not null and "agentId" is not null
        ${nums ? Prisma.sql`and ${conversaNoEscopo(Prisma.sql`"conversationId"`, nums)}` : Prisma.empty}
      group by 1, 2
    `));
    const porEscala = new Map<string, number>();
    for (const n of notas) porEscala.set(n.scale, (porEscala.get(n.scale) ?? 0) + Number(n.answered));
    const satisfactionScale = [...porEscala.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const notaDe = (userId: string) => {
      const n = notas.find((x) => x.agentId === userId && x.scale === satisfactionScale);
      if (!n) return null;
      const answered = Number(n.answered);
      return { answered, avg: n.avg != null ? Math.round(Number(n.avg) * 100) / 100 : null, nps: satisfactionScale === 'scale_10' ? Math.round(((Number(n.promoters) - Number(n.detractors)) / answered) * 100) : null };
    };
    // vendas pela régua comum com a meta: "Comprou" + orçamento pago sem encerramento − estornos.
    // Pagamento sem encerramento também é atendimento concluído (entra em `closed` e na conversão)
    const vendas = await this.load.run(() => this.prisma.$queryRaw<{ userId: string; won: number; revenue: number; paidOnly: number }[]>(vendasPorConsultorSql(tenantId, from, to, f.tagIds?.length ? this.eventoTemTag(f.tagIds) : undefined, nums)));
    const porId = new Map(rows.map((r) => [r.userId, r]));
    const soVendas = vendas.filter((v) => v.userId && !porId.has(v.userId)).map((v) => v.userId);
    const nomes = soVendas.length ? await this.prisma.user.findMany({ where: { id: { in: soVendas } }, select: { id: true, name: true } }) : [];
    const ids = [...new Set([...rows.map((r) => r.userId), ...vendas.map((v) => v.userId).filter(Boolean)])];
    const ranking = ids
      .map((id) => {
        const r = porId.get(id);
        const v = vendas.find((x) => x.userId === id);
        const closed = Number(r?.closed ?? 0) + Number(v?.paidOnly ?? 0);
        const won = Number(v?.won ?? 0);
        const name = r?.name ?? nomes.find((n) => n.id === id)?.name ?? '(usuário removido)';
        return { userId: id, name, closed, won, revenue: Number(v?.revenue ?? 0), conversionRate: closed ? (won / closed) * 100 : 0, avgHandleMin: r?.tmaMin != null ? Number(r.tmaMin) : null, satisfaction: notaDe(id) };
      });
    // pontuação composta (packages/shared/ranking.ts): faturamento, vendas, conversão, satisfação e
    // tempo de atendimento com os pesos da empresa. Empate → faturamento → vendas → nome
    const notas_ = rankingScores(
      ranking.map((r) => ({ userId: r.userId, revenue: r.revenue, won: r.won, closed: r.closed, avgHandleMin: r.avgHandleMin, satisfactionAvg: r.satisfaction?.avg ?? null })),
      weights,
      satisfactionScale ? SURVEY_SCALE_MAX[satisfactionScale as SurveyScale] : null,
    );
    const pontuado = ranking
      .map((r) => ({ ...r, score: notas_.get(r.userId)?.score ?? 0, scoreParts: notas_.get(r.userId)?.parts ?? null }))
      .sort((a, b) => b.score - a.score || b.revenue - a.revenue || b.won - a.won || a.name.localeCompare(b.name));
    const closed = pontuado.reduce((a, r) => a + r.closed, 0);
    const won = pontuado.reduce((a, r) => a + r.won, 0);
    const revenue = Math.round(pontuado.reduce((a, r) => a + r.revenue * 100, 0)) / 100;
    return { period: { from, to }, satisfactionScale, weights, totals: { closed, won, revenue, conversionRate: closed ? (won / closed) * 100 : 0 }, ranking: pontuado.map((r, i) => ({ position: i + 1, ...r })) };
  }

  @Get('saved')
  saved(@CurrentUser() u: AuthUser) {
    return this.prisma.savedReport.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' } });
  }

  @Post('saved')
  save(@CurrentUser() u: AuthUser, @Body() body: { name: string; definition: unknown }) {
    const definition = ReportDefinition.parse(body.definition);
    return this.prisma.savedReport.create({ data: { tenantId: u.tenantId, name: String(body.name).slice(0, 80), definition } });
  }

  @Delete('saved/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.prisma.savedReport.delete({ where: { id, tenantId: u.tenantId } });
  }

  /**
   * Vendas do período, lidas da tabela `sales` (uma linha por encerramento "Comprou", nunca
   * alterada). Entra no dia do fechamento. Atendente que saiu da equipe continua com o nome
   * enquanto o usuário existir; apagado vira "(sem atendente)".
   */
  private async sales(tenantId: string, from: Date, to: Date, filtro: Filtro) {
    const conds = [Prisma.sql`s."tenantId" = ${tenantId}`, Prisma.sql`s."closedAt" >= ${from}`, Prisma.sql`s."closedAt" < ${to}`, Prisma.sql`s."refundedAt" is null`];
    if (filtro.agentId) conds.push(Prisma.sql`s."userId" = ${filtro.agentId}`);
    if (filtro.tagIds) conds.push(this.vendaTemTag(filtro.tagIds));
    if (filtro.numberIds) conds.push(conversaNoEscopo(Prisma.sql`s."conversationId"`, filtro.numberIds));
    const where = Prisma.join(conds, ' and ');
    // estornos do período (pela data do estorno): a venda saiu do faturamento acima, mas a gestão precisa ver
    const condsEstorno = [Prisma.sql`s."tenantId" = ${tenantId}`, Prisma.sql`s."refundedAt" >= ${from}`, Prisma.sql`s."refundedAt" < ${to}`];
    if (filtro.agentId) condsEstorno.push(Prisma.sql`s."userId" = ${filtro.agentId}`);
    if (filtro.numberIds) condsEstorno.push(conversaNoEscopo(Prisma.sql`s."conversationId"`, filtro.numberIds));
    const [totais, byDay, byAgent, bySource, estornos] = await this.load.all([
      () => this.prisma.$queryRaw<{ total: number | null; count: number }[]>(Prisma.sql`
        select sum(s.amount)::float as total, count(*)::int as count from sales s where ${where}
      `),
      () => this.prisma.$queryRaw<{ label: string; value: number }[]>(Prisma.sql`
        select to_char(s."closedAt", 'YYYY-MM-DD') as label, sum(s.amount)::float as value
        from sales s where ${where} group by 1 order by 1
      `),
      () => this.prisma.$queryRaw<{ label: string; value: number; count: number }[]>(Prisma.sql`
        select coalesce(u.name, '(sem atendente)') as label, sum(s.amount)::float as value, count(*)::int as count
        from sales s left join users u on u.id = s."userId"
        where ${where} group by 1 order by 2 desc
      `),
      // origem do dinheiro (docs/orcamentos.md#venda): Pix automático (Asaas) × orçamento pago por
      // fora × venda digitada no encerramento (sem orçamento, ou o adicional além dele)
      () => this.prisma.$queryRaw<{ source: 'asaas' | 'manual' | 'close'; value: number; count: number }[]>(Prisma.sql`
        select case when s."budgetId" is null then 'close' when b."paidVia" = 'asaas' then 'asaas' else 'manual' end as source,
               sum(s.amount)::float as value, count(*)::int as count
        from sales s left join budgets b on b.id = s."budgetId"
        where ${where} group by 1
      `),
      () => this.prisma.$queryRaw<{ count: number; value: number | null }[]>(Prisma.sql`
        select count(*)::int as count, sum(s.amount)::float as value from sales s where ${Prisma.join(condsEstorno, ' and ')}
      `),
    ]);
    const total = Number(totais[0]?.total ?? 0);
    const count = Number(totais[0]?.count ?? 0);
    return {
      total,
      count,
      avgTicket: count ? total / count : null,
      byDay: byDay.map((r) => ({ label: r.label, value: Number(r.value) })),
      byAgent: byAgent.map((r) => ({ label: r.label, value: Number(r.value), count: Number(r.count), avgTicket: Number(r.value) / Number(r.count) })),
      bySource: (['asaas', 'manual', 'close'] as const).map((k) => { const r = bySource.find((x) => x.source === k); return { source: k, value: Number(r?.value ?? 0), count: Number(r?.count ?? 0) }; }),
      refunds: { count: Number(estornos[0]?.count ?? 0), value: Number(estornos[0]?.value ?? 0) },
    };
  }

  /**
   * "Não comprou" por tag do encerramento, no período. Sai do histórico (`conversation_events`)
   * pelo mesmo motivo das vendas: reabrir limpa o desfecho da conversa. Encerramento com duas
   * tags conta nas duas barras. Antes das tags o motivo era texto livre: evento sem `tagIds`
   * cai no texto gravado (sem o sufixo "encerrado em massa").
   */
  private async lostReasons(tenantId: string, from: Date, to: Date, filtro: Filtro) {
    const conds = [Prisma.sql`e."tenantId" = ${tenantId}`, Prisma.sql`e.type = 'closed'`, Prisma.sql`e.outcome = 'lost'`, Prisma.sql`not e."ignoreInReports"`, semIsento(Prisma.sql`e."conversationId"`), Prisma.sql`e."createdAt" >= ${from}`, Prisma.sql`e."createdAt" < ${to}`];
    if (filtro.agentId) conds.push(doConsultor(filtro.agentId));
    if (filtro.tagIds) conds.push(this.eventoTemTag(filtro.tagIds));
    if (filtro.numberIds) conds.push(conversaNoEscopo(Prisma.sql`e."conversationId"`, filtro.numberIds));
    // pelo MOTIVO do encerramento (close_reasons); sem motivo, o texto gravado (encerramentos antigos)
    const rows = await this.prisma.$queryRaw<{ label: string; value: number; closeReasonId: string | null; color: string | null }[]>(Prisma.sql`
      select cr.id as "closeReasonId", cr.color,
             coalesce(cr.name, nullif(trim(regexp_replace(coalesce(e.reason, ''), '(\\s*·\\s*)?encerrado em massa$', '')), ''), '(sem motivo)') as label,
             count(*)::int as value
      from conversation_events e
      left join close_reasons cr on cr.id = e."closeReasonId"
      where ${Prisma.join(conds, ' and ')}
      group by 1, 2, 3
      order by 4 desc, 3
    `);
    // `closeReasonId` null = encerramento sem motivo cadastrado (antigo/texto): a auditoria filtra pelo rótulo
    return rows.map((r) => ({ label: r.label, value: Number(r.value), closeReasonId: r.closeReasonId, color: r.color, tagId: null as string | null }));
  }

  /**
   * Venda (`sales s`) com a tag: escolhida no encerramento dela ou presente na conversa. O
   * encerramento é o evento `closed` "Comprou" gravado logo depois da venda (mesma operação).
   * Só a conversa não basta: reabrir tira dela as tags do encerramento anterior.
   */
  private vendaTemTag(tagIds: string[]) {
    return Prisma.sql`(exists (select 1 from conversation_tags ct where ct."conversationId" = s."conversationId" and ct."tagId" in (${Prisma.join(tagIds)}))
      or exists (select 1 from conversation_events ev where ev."conversationId" = s."conversationId" and ev.type = 'closed' and ev.outcome = 'won'
        and ev."createdAt" >= s."closedAt" and ev."createdAt" < s."closedAt" + interval '1 minute' and (ev."tagIds" || ev."tagSnapshot") && ARRAY[${Prisma.join(tagIds)}]::text[]))`;
  }

  /** Encerramento com a tag: escolhida nele ou presente na conversa. */
  private eventoTemTag(tagIds: string[]) {
    // retrato do atendimento (`tagSnapshot`: as transitórias saem da conversa ao encerrar) ou tag atual
    return Prisma.sql`(e."tagIds" && ARRAY[${Prisma.join(tagIds)}]::text[] or e."tagSnapshot" && ARRAY[${Prisma.join(tagIds)}]::text[] or exists (select 1 from conversation_tags ct2 where ct2."conversationId" = e."conversationId" and ct2."tagId" in (${Prisma.join(tagIds)})))`;
  }

  /**
   * Série agrupada. Parametrizado via Prisma.sql — sem concatenação de string do usuário.
   *
   * Cada métrica tem a SUA janela de tempo, porque a conversa é uma só por pessoa e reabre a
   * cada retorno (conversations/reopen.ts) — filtrar tudo pela data de criação da conversa
   * deixava de fora quem voltou no período e somava mensagens de meses atrás:
   *  - `conversations` = ATENDIMENTOS INICIADOS: conversa nova + conversa reaberta no período;
   *  - `messages_*` = mensagens enviadas/recebidas no período;
   *  - `closed`/vendas = ENCERRAMENTOS no período (`conversation_events`), pelo dia do encerramento,
   *    por quem encerrou e com as tags escolhidas naquele encerramento;
   *  - `avg_first_response_min` = conversas novas no período (tempo até a 1ª resposta).
   * Atendimento encerrado como interno (`ignoreInReports`) fica de fora de todas, menos das
   * contagens de mensagens. Conversa de contato isento de ticket (`ticketExempt`) fica de fora
   * de todas, inclusive das mensagens (docs/contatos-isentos.md).
   */
  private async query(tenantId: string, d: ReportDefinition, numberIds?: string[]): Promise<{ label: string; value: number }[]> {
    const porEncerramento = ['closed', 'revenue', 'won', 'lost', 'win_rate'].includes(d.metric);
    const usaMensagens = d.metric === 'messages_in' || d.metric === 'messages_out';
    const porInicio = d.metric === 'conversations';
    // instante que cai na janela (e define o dia/semana/mês do agrupamento)
    const quando = porEncerramento ? Prisma.sql`e."createdAt"` : usaMensagens ? Prisma.sql`m."createdAt"` : porInicio ? Prisma.sql`i.em` : Prisma.sql`c."createdAt"`;
    const dim = {
      day: Prisma.sql`to_char(${quando}, 'YYYY-MM-DD')`,
      week: Prisma.sql`to_char(date_trunc('week', ${quando}), 'YYYY-MM-DD')`,
      month: Prisma.sql`to_char(${quando}, 'YYYY-MM')`,
      tag: Prisma.sql`coalesce(t.name, '(sem tag)')`,
      status: Prisma.sql`c.status::text`,
      number: Prisma.sql`n.label`,
      company: Prisma.sql`coalesce(co.name, '(sem empresa)')`,
      // encerramento: quem encerrou; o resto: com quem a conversa está
      agent: porEncerramento ? Prisma.sql`coalesce(ea.name, '(automático)')` : Prisma.sql`coalesce(a.name, '(não atribuído)')`,
      origin: Prisma.sql`c.origin::text`,
      campaign: Prisma.sql`coalesce(c."originData"->>'headline', case when c.origin = 'ad' then '(anúncio sem título)' else '(orgânico)' end)`,
      // motivo do encerramento (só faz sentido em métrica de encerramento)
      reason: porEncerramento ? Prisma.sql`coalesce(cr.name, '(sem motivo)')` : Prisma.sql`'(só em encerramentos)'`,
    }[d.groupBy];

    // com o join de tags uma linha vira várias: as contagens são por id distinto
    const metric = {
      conversations: Prisma.sql`count(distinct i.k)`,
      // importada do histórico do provider não é atendimento feito pelo painel
      messages_in: Prisma.sql`count(distinct m.id) filter (where m.direction = 'in' and not m.imported)`,
      messages_out: Prisma.sql`count(distinct m.id) filter (where m.direction = 'out' and not m.internal and not m.imported)`,
      avg_first_response_min: Prisma.sql`avg(extract(epoch from (fr.first_out - c."createdAt")) / 60)`,
      closed: Prisma.sql`count(distinct e.id)`,
      // por tag, a venda com duas tags entra nas duas barras (uma vez em cada) — é o esperado
      revenue: Prisma.sql`coalesce(sum(e."outcomeValue"), 0)`,
      won: Prisma.sql`count(distinct e.id) filter (where e.outcome = 'won')`,
      lost: Prisma.sql`count(distinct e.id) filter (where e.outcome = 'lost')`,
      win_rate: Prisma.sql`case when count(distinct e.id) filter (where e.outcome <> 'none') = 0 then 0
        else count(distinct e.id) filter (where e.outcome = 'won')::float
             / count(distinct e.id) filter (where e.outcome <> 'none') end`,
    }[d.metric];

    const filters: Prisma.Sql[] = [Prisma.sql`c."tenantId" = ${tenantId}`, Prisma.sql`not c."ticketExempt"`];
    if (porEncerramento) filters.push(Prisma.sql`e."createdAt" >= ${d.from}`, Prisma.sql`e."createdAt" < ${d.to}`);
    else if (usaMensagens) filters.push(Prisma.sql`m."createdAt" >= ${d.from}`, Prisma.sql`m."createdAt" < ${d.to}`);
    else if (!porInicio) filters.push(Prisma.sql`c."createdAt" >= ${d.from}`, Prisma.sql`c."createdAt" < ${d.to}`, Prisma.sql`not ${encerradoInterno(Prisma.sql`c.id`, Prisma.sql`c."createdAt"`)}`);
    if (d.filters.status) filters.push(Prisma.sql`c.status = ${d.filters.status}::"ConversationStatus"`);
    if (d.filters.numberId) filters.push(Prisma.sql`c."numberId" = ${d.filters.numberId}`);
    if (numberIds) filters.push(Prisma.sql`c."numberId" in (${Prisma.join(numberIds)})`);
    if (d.filters.origin) filters.push(Prisma.sql`c.origin = ${d.filters.origin}::"ConversationOrigin"`);
    if (d.filters.tagIds?.length) {
      filters.push(porEncerramento ? this.eventoTemTag(d.filters.tagIds) : Prisma.sql`c.id in (select "conversationId" from conversation_tags where "tagId" in (${Prisma.join(d.filters.tagIds)}))`);
    }
    if (d.filters.agentId) filters.push(porEncerramento ? doConsultor(d.filters.agentId) : Prisma.sql`c."assigneeId" = ${d.filters.agentId}`);

    /**
     * Cada join entra só quando a métrica ou o agrupamento usa: mensagens × tags de cada
     * conversa multiplicavam as linhas e eram os picos de CPU do Postgres (a visão pronta roda
     * várias destas de uma vez).
     */
    const joins: Prisma.Sql[] = [];
    if (porInicio) {
      // atendimento iniciado = conversa criada OU reaberta no período; `k` identifica cada início
      joins.push(Prisma.sql`join (
        select c0.id as conv, c0."createdAt" as em, c0.id || '@' || c0."createdAt"::text as k from conversations c0
          where c0."tenantId" = ${tenantId} and c0."createdAt" >= ${d.from} and c0."createdAt" < ${d.to}
        union all
        select e0."conversationId", e0."createdAt", e0.id from conversation_events e0
          where e0."tenantId" = ${tenantId} and e0.type = 'reopened' and e0."createdAt" >= ${d.from} and e0."createdAt" < ${d.to}
      ) i on i.conv = c.id and not ${encerradoInterno(Prisma.sql`i.conv`, Prisma.sql`i.em`)}`);
    }
    if (d.groupBy === 'number') joins.push(Prisma.sql`join whatsapp_numbers n on n.id = c."numberId"`);
    if (d.groupBy === 'company') joins.push(Prisma.sql`left join whatsapp_numbers nco on nco.id = c."numberId" left join companies co on co.id = nco."companyId"`);
    if (d.groupBy === 'agent' && !porEncerramento) joins.push(Prisma.sql`left join users a on a.id = c."assigneeId"`);
    if (porEncerramento) {
      joins.push(Prisma.sql`join conversation_events e on e."conversationId" = c.id and e.type = 'closed' and not e."ignoreInReports"`);
      if (d.groupBy === 'agent') joins.push(Prisma.sql`left join users ea on ea.id = e."actorId"`);
      if (d.groupBy === 'reason') joins.push(Prisma.sql`left join close_reasons cr on cr.id = e."closeReasonId"`);
    }
    if (usaMensagens) joins.push(Prisma.sql`join messages m on m."conversationId" = c.id`);
    if (d.groupBy === 'tag') {
      // encerramento: as tags escolhidas NELE (a conversa perde as de encerramento ao reabrir);
      // o resto: as tags que a conversa tem
      joins.push(porEncerramento
        ? Prisma.sql`left join lateral (select distinct x as id from unnest(e."tagIds" || e."tagSnapshot") as x) etid on true left join tags t on t.id = etid.id`
        : Prisma.sql`left join conversation_tags ct on ct."conversationId" = c.id left join tags t on t.id = ct."tagId"`);
    }
    if (d.metric === 'avg_first_response_min') {
      joins.push(Prisma.sql`left join lateral (
        select min(mo."createdAt") as first_out from messages mo where mo."conversationId" = c.id and mo.direction = 'out' and not mo.imported
      ) fr on true`);
    }

    const rows = await this.prisma.$queryRaw<{ label: string; value: number | null }[]>(Prisma.sql`
      select ${dim} as label, ${metric}::float as value
      from conversations c
      ${joins.length ? Prisma.join(joins, '\n') : Prisma.empty}
      where ${Prisma.join(filters, ' and ')}
      group by 1
      order by 1
    `);
    return rows.map((r) => ({ label: r.label, value: Number(r.value ?? 0) }));
  }
}

@Module({ imports: [AuthModule, BillingModule], controllers: [ReportsController] })
export class ReportsModule {}

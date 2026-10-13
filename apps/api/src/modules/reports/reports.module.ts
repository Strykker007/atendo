import { Body, Controller, Delete, Get, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

/**
 * DSL de relatório: parâmetros escolhidos na UI -> query controlada -> série para gráfico.
 * Nunca recebe SQL do usuário; só dimensões/métricas de uma lista fechada.
 */
export const ReportDefinition = z.object({
  metric: z.enum(['conversations', 'messages_in', 'messages_out', 'avg_first_response_min', 'revenue', 'won', 'lost', 'win_rate']),
  groupBy: z.enum(['day', 'week', 'month', 'tag', 'status', 'number', 'agent', 'origin', 'campaign']),
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
});
type Filtro = { tagIds?: string[]; agentId?: string };

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
});

/** "5511999998888" → "+55 11 99999-8888". Fora do padrão BR devolve só com o "+". */
function formatPhone(phone: string) {
  const d = phone.split('@')[0].split(':')[0].replace(/\D/g, '');
  const br = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${d}`;
}

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('reports.view')
class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('run')
  async run(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const def = ReportDefinition.parse(body);
    return { definition: def, series: await this.query(u.tenantId, def) };
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
    const filtro: Filtro = { tagIds: f.tagIds?.length ? f.tagIds : undefined, agentId: f.agentId };
    const base = { from, to, filters: filtro, chart: 'bar' as const };
    const t = u.tenantId;
    // conversa: tem a tag / está com o consultor
    const conv: Prisma.ConversationWhereInput = {
      tenantId: t,
      ...(filtro.tagIds && { tags: { some: { tagId: { in: filtro.tagIds } } } }),
      ...(filtro.agentId && { assigneeId: filtro.agentId }),
    };
    // encerramento: tag escolhida nele (ou na conversa) / quem encerrou
    const fechou: Prisma.ConversationEventWhereInput = {
      tenantId: t,
      type: 'closed',
      createdAt: { gte: from, lt: to },
      ...(filtro.tagIds && { OR: [{ tagIds: { hasSome: filtro.tagIds } }, { conversation: { tags: { some: { tagId: { in: filtro.tagIds } } } } }] }),
      ...(filtro.agentId && { actorId: filtro.agentId }),
    };
    const [total, closed, waitingNow, inProgressNow, msgsIn, msgsOut, firstResp, byDay, byAgent, byOrigin, byCampaign, byTag, byStatus, won, lost] = await Promise.all([
      this.prisma.conversation.count({ where: { ...conv, createdAt: { gte: from, lt: to } } }),
      // atendimentos ENCERRADOS no período (um encerramento = um atendimento), não conversas
      // criadas no período que por acaso estão fechadas agora
      this.prisma.conversationEvent.count({ where: fechou }),
      this.prisma.conversation.count({ where: { ...conv, status: 'waiting' } }),
      this.prisma.conversation.count({ where: { ...conv, status: 'in_progress' } }),
      this.prisma.message.count({ where: { direction: 'in', createdAt: { gte: from, lt: to }, conversation: conv } }),
      this.prisma.message.count({ where: { direction: 'out', internal: false, createdAt: { gte: from, lt: to }, conversation: conv } }),
      this.query(t, { ...base, metric: 'avg_first_response_min', groupBy: 'status' }),
      this.query(t, { ...base, metric: 'conversations', groupBy: 'day' }),
      this.query(t, { ...base, metric: 'conversations', groupBy: 'agent' }),
      this.query(t, { ...base, metric: 'conversations', groupBy: 'origin' }),
      this.query(t, { ...base, metric: 'conversations', groupBy: 'campaign' }),
      this.query(t, { ...base, metric: 'conversations', groupBy: 'tag' }),
      this.query(t, { ...base, metric: 'conversations', groupBy: 'status' }),
      // vendas saem do HISTÓRICO de atendimentos, não da conversa: a conversa guarda só o
      // último desfecho, e a mesma pessoa pode comprar em março e voltar a comprar em junho —
      // contar pela conversa somaria uma venda só
      this.prisma.conversationEvent.aggregate({ where: { ...fechou, outcome: 'won' }, _count: { _all: true }, _sum: { outcomeValue: true } }),
      this.prisma.conversationEvent.count({ where: { ...fechou, outcome: 'lost' } }),
    ]);
    const respVals = firstResp.filter((r) => r.value > 0).map((r) => r.value);
    const [sales, lostReasons] = await Promise.all([this.sales(t, from, to, filtro), this.lostReasons(t, from, to, filtro)]);
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
        won: won._count._all,
        lost,
        revenue: Number(won._sum.outcomeValue ?? 0),
        winRate: won._count._all + lost > 0 ? won._count._all / (won._count._all + lost) : null,
      },
      sales,
      lostReasons,
      series: { byDay, byAgent, byOrigin, byCampaign: byCampaign.filter((c) => c.label !== '(orgânico)'), byTag: byTag.filter((c) => c.label !== '(sem tag)').sort((a, b) => b.value - a.value).slice(0, 8), byStatus },
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
    // escapa curingas do ILIKE: o termo continua parametrizado, isto só evita "%" casar tudo
    const like = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = (v: string) => v.replace(/\D/g, '');
    // itens gravados como array JSON; venda em texto livre tem `items` nulo
    const itensDe = Prisma.sql`jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end)`;
    const produtoCasa = (t: string) => Prisma.sql`(s.products ilike ${like(t)} or exists (select 1 from ${itensDe} i where i->>'description' ilike ${like(t)}))`;

    const conds: Prisma.Sql[] = [Prisma.sql`s."tenantId" = ${u.tenantId}`, Prisma.sql`s."closedAt" >= ${from}`, Prisma.sql`s."closedAt" < ${to}`];
    if (f.userId) conds.push(Prisma.sql`s."userId" = ${f.userId}`);
    if (f.tagIds?.length) conds.push(Prisma.sql`exists (select 1 from conversation_tags ct where ct."conversationId" = s."conversationId" and ct."tagId" in (${Prisma.join(f.tagIds)}))`);
    if (f.contactId) conds.push(Prisma.sql`s."contactId" = ${f.contactId}`);
    if (f.phone && digits(f.phone)) conds.push(Prisma.sql`c.phone like ${like(digits(f.phone))}`);
    if (f.customerName) conds.push(Prisma.sql`c.name ilike ${like(f.customerName)}`);
    if (f.search) {
      const ors = [Prisma.sql`c.name ilike ${like(f.search)}`, produtoCasa(f.search)];
      if (digits(f.search).length >= 3) ors.push(Prisma.sql`c.phone like ${like(digits(f.search))}`);
      conds.push(Prisma.sql`(${Prisma.join(ors, ' or ')})`);
    }
    const where = Prisma.join(conds, ' and ');
    const from_ = Prisma.sql`from sales s join contacts c on c.id = s."contactId" left join users usr on usr.id = s."userId"`;

    const [rows, resumo, agents] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; closedAt: Date; amount: number; products: string | null; items: unknown; notes: string | null; conversationId: string; contactId: string; contactName: string | null; phone: string; userId: string | null; userName: string | null }[]>(Prisma.sql`
        select s.id, s."closedAt", s.amount::float as amount, s.products, s.items, s.notes, s."conversationId",
               c.id as "contactId", c.name as "contactName", c.phone, s."userId", usr.name as "userName"
        ${from_} where ${where}
        order by s."closedAt" desc
        limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}
      `),
      this.prisma.$queryRaw<{ count: number; revenue: number | null; items: number | null }[]>(Prisma.sql`
        select count(*)::int as count, sum(s.amount)::float as revenue,
               -- venda em texto livre conta como 1 produto
               sum(case when jsonb_typeof(s.items) = 'array' then jsonb_array_length(s.items) else 1 end)::int as items
        ${from_} where ${where}
      `),
      // atendentes do tenant para o filtro (inclui quem não vendeu, para o dropdown não "sumir" gente)
      this.prisma.user.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
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
    const conds = [Prisma.sql`s."tenantId" = ${tenantId}`, Prisma.sql`s."closedAt" >= ${from}`, Prisma.sql`s."closedAt" < ${to}`];
    if (filtro.agentId) conds.push(Prisma.sql`s."userId" = ${filtro.agentId}`);
    if (filtro.tagIds) conds.push(Prisma.sql`exists (select 1 from conversation_tags ct where ct."conversationId" = s."conversationId" and ct."tagId" in (${Prisma.join(filtro.tagIds)}))`);
    const where = Prisma.join(conds, ' and ');
    const [totais, byDay, byAgent] = await Promise.all([
      this.prisma.$queryRaw<{ total: number | null; count: number }[]>(Prisma.sql`
        select sum(s.amount)::float as total, count(*)::int as count from sales s where ${where}
      `),
      this.prisma.$queryRaw<{ label: string; value: number }[]>(Prisma.sql`
        select to_char(s."closedAt", 'YYYY-MM-DD') as label, sum(s.amount)::float as value
        from sales s where ${where} group by 1 order by 1
      `),
      this.prisma.$queryRaw<{ label: string; value: number; count: number }[]>(Prisma.sql`
        select coalesce(u.name, '(sem atendente)') as label, sum(s.amount)::float as value, count(*)::int as count
        from sales s left join users u on u.id = s."userId"
        where ${where} group by 1 order by 2 desc
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
    };
  }

  /**
   * "Não comprou" por tag do encerramento, no período. Sai do histórico (`conversation_events`)
   * pelo mesmo motivo das vendas: reabrir limpa o desfecho da conversa. Encerramento com duas
   * tags conta nas duas barras. Antes das tags o motivo era texto livre: evento sem `tagIds`
   * cai no texto gravado (sem o sufixo "encerrado em massa").
   */
  private async lostReasons(tenantId: string, from: Date, to: Date, filtro: Filtro) {
    const conds = [Prisma.sql`e."tenantId" = ${tenantId}`, Prisma.sql`e.type = 'closed'`, Prisma.sql`e.outcome = 'lost'`, Prisma.sql`e."createdAt" >= ${from}`, Prisma.sql`e."createdAt" < ${to}`];
    if (filtro.agentId) conds.push(Prisma.sql`e."actorId" = ${filtro.agentId}`);
    if (filtro.tagIds) conds.push(this.eventoTemTag(filtro.tagIds));
    const rows = await this.prisma.$queryRaw<{ label: string; value: number }[]>(Prisma.sql`
      select case when coalesce(cardinality(e."tagIds"), 0) = 0
               then coalesce(nullif(trim(regexp_replace(coalesce(e.reason, ''), '(\\s*·\\s*)?encerrado em massa$', '')), ''), '(sem tag)')
               else coalesce(t.name, '(tag excluída)') end as label,
             count(distinct e.id)::int as value
      from conversation_events e
      left join lateral unnest(e."tagIds") as tid(id) on true
      left join tags t on t.id = tid.id
      where ${Prisma.join(conds, ' and ')}
      group by 1
      order by 2 desc, 1
    `);
    return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
  }

  /** Encerramento com a tag: escolhida nele ou presente na conversa. */
  private eventoTemTag(tagIds: string[]) {
    return Prisma.sql`(e."tagIds" && ARRAY[${Prisma.join(tagIds)}]::text[] or exists (select 1 from conversation_tags ct2 where ct2."conversationId" = e."conversationId" and ct2."tagId" in (${Prisma.join(tagIds)})))`;
  }

  /** Conversas agrupadas. Parametrizado via Prisma.sql — sem concatenação de string do usuário. */
  private async query(tenantId: string, d: ReportDefinition): Promise<{ label: string; value: number }[]> {
    // em métrica de venda, o dia que importa é o do encerramento, não o da abertura da conversa
    const vendasDim = ['revenue', 'won', 'lost', 'win_rate'].includes(d.metric);
    const quando = vendasDim ? Prisma.sql`e."createdAt"` : Prisma.sql`c."createdAt"`;
    const dim = {
      day: Prisma.sql`to_char(${quando}, 'YYYY-MM-DD')`,
      week: Prisma.sql`to_char(date_trunc('week', ${quando}), 'YYYY-MM-DD')`,
      month: Prisma.sql`to_char(${quando}, 'YYYY-MM')`,
      tag: Prisma.sql`coalesce(t.name, '(sem tag)')`,
      status: Prisma.sql`c.status::text`,
      number: Prisma.sql`n.label`,
      agent: vendasDim ? Prisma.sql`coalesce(ea.name, a.name, '(não atribuído)')` : Prisma.sql`coalesce(a.name, '(não atribuído)')`,
      origin: Prisma.sql`c.origin::text`,
      campaign: Prisma.sql`coalesce(c."originData"->>'headline', case when c.origin = 'ad' then '(anúncio sem título)' else '(orgânico)' end)`,
    }[d.groupBy];

    /**
     * Métricas de venda contam ATENDIMENTOS encerrados (`conversation_events`), não conversas.
     * A conversa guarda só o último desfecho: a mesma pessoa comprando em março e de novo em
     * junho apareceria como uma venda só. O join entra apenas nestas métricas — somado às de
     * mensagem, multiplicaria as linhas e inflaria a contagem.
     */
    const vendas = ['revenue', 'won', 'lost', 'win_rate'].includes(d.metric);
    const metric = {
      conversations: Prisma.sql`count(distinct c.id)`,
      messages_in: Prisma.sql`count(m.id) filter (where m.direction = 'in')`,
      messages_out: Prisma.sql`count(m.id) filter (where m.direction = 'out')`,
      avg_first_response_min: Prisma.sql`avg(extract(epoch from (fr.first_out - c."createdAt")) / 60)`,
      revenue: Prisma.sql`coalesce(sum(e."outcomeValue"), 0)`,
      won: Prisma.sql`count(e.id) filter (where e.outcome = 'won')`,
      lost: Prisma.sql`count(e.id) filter (where e.outcome = 'lost')`,
      win_rate: Prisma.sql`case when count(e.id) filter (where e.outcome <> 'none') = 0 then 0
        else count(e.id) filter (where e.outcome = 'won')::float
             / count(e.id) filter (where e.outcome <> 'none') end`,
    }[d.metric];

    // a janela de tempo também muda: venda entra no mês em que foi fechada
    const filters: Prisma.Sql[] = vendas
      ? [Prisma.sql`c."tenantId" = ${tenantId}`, Prisma.sql`e."createdAt" >= ${d.from}`, Prisma.sql`e."createdAt" < ${d.to}`]
      : [Prisma.sql`c."tenantId" = ${tenantId}`, Prisma.sql`c."createdAt" >= ${d.from}`, Prisma.sql`c."createdAt" < ${d.to}`];
    if (d.filters.status) filters.push(Prisma.sql`c.status = ${d.filters.status}::"ConversationStatus"`);
    if (d.filters.numberId) filters.push(Prisma.sql`c."numberId" = ${d.filters.numberId}`);
    if (d.filters.origin) filters.push(Prisma.sql`c.origin = ${d.filters.origin}::"ConversationOrigin"`);
    if (d.filters.tagIds?.length) {
      filters.push(vendas ? this.eventoTemTag(d.filters.tagIds) : Prisma.sql`c.id in (select "conversationId" from conversation_tags where "tagId" in (${Prisma.join(d.filters.tagIds)}))`);
    }
    if (d.filters.agentId) filters.push(vendas ? Prisma.sql`e."actorId" = ${d.filters.agentId}` : Prisma.sql`c."assigneeId" = ${d.filters.agentId}`);

    /**
     * Cada join entra só quando a métrica ou o agrupamento usa. Antes todos entravam sempre:
     * mensagens × tags de cada conversa multiplicavam as linhas (uma conversa com 300
     * mensagens e 3 tags virava 900), e a visão pronta roda sete destas consultas de uma vez —
     * eram os picos de CPU do Postgres. A multiplicação também inflava soma e contagem de
     * venda (`revenue`/`won`/`lost`) e pesava a média de 1ª resposta pelo nº de mensagens.
     */
    const usaMensagens = d.metric === 'messages_in' || d.metric === 'messages_out';
    const joins: Prisma.Sql[] = [];
    if (d.groupBy === 'number') joins.push(Prisma.sql`join whatsapp_numbers n on n.id = c."numberId"`);
    if (d.groupBy === 'agent') joins.push(Prisma.sql`left join users a on a.id = c."assigneeId"`);
    if (vendas) joins.push(Prisma.sql`join conversation_events e on e."conversationId" = c.id and e.type = 'closed'`);
    if (vendas && d.groupBy === 'agent') joins.push(Prisma.sql`left join users ea on ea.id = e."actorId"`);
    if (usaMensagens) joins.push(Prisma.sql`left join messages m on m."conversationId" = c.id`);
    if (d.groupBy === 'tag') joins.push(Prisma.sql`left join conversation_tags ct on ct."conversationId" = c.id left join tags t on t.id = ct."tagId"`);
    if (d.metric === 'avg_first_response_min') {
      joins.push(Prisma.sql`left join lateral (
        select min(mo."createdAt") as first_out from messages mo where mo."conversationId" = c.id and mo.direction = 'out'
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

@Module({ imports: [AuthModule], controllers: [ReportsController] })
export class ReportsModule {}

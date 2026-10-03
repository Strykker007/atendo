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
    .object({ tagIds: z.array(z.string().uuid()).optional(), status: z.enum(['waiting', 'in_progress', 'closed']).optional(), numberId: z.string().uuid().optional(), origin: z.enum(['organic', 'ad', 'post', 'link']).optional() })
    .default({}),
  chart: z.enum(['bar', 'line', 'pie']).default('bar'),
});
export type ReportDefinition = z.infer<typeof ReportDefinition>;

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
  @Get('overview')
  async overview(@CurrentUser() u: AuthUser, @Query('from') fromQ?: string, @Query('to') toQ?: string) {
    const to = toQ ? new Date(toQ) : new Date(Date.now() + 86_400_000);
    const from = fromQ ? new Date(fromQ) : new Date(Date.now() - 29 * 86_400_000);
    const base = { from, to, filters: {}, chart: 'bar' as const };
    const t = u.tenantId;
    const [total, closed, waitingNow, inProgressNow, msgsIn, msgsOut, firstResp, byDay, byAgent, byOrigin, byCampaign, byTag, byStatus, won, lost] = await Promise.all([
      this.prisma.conversation.count({ where: { tenantId: t, createdAt: { gte: from, lt: to } } }),
      // atendimentos ENCERRADOS no período (um encerramento = um atendimento), não conversas
      // criadas no período que por acaso estão fechadas agora
      this.prisma.conversationEvent.count({ where: { tenantId: t, type: 'closed', createdAt: { gte: from, lt: to } } }),
      this.prisma.conversation.count({ where: { tenantId: t, status: 'waiting' } }),
      this.prisma.conversation.count({ where: { tenantId: t, status: 'in_progress' } }),
      this.prisma.message.count({ where: { direction: 'in', createdAt: { gte: from, lt: to }, conversation: { tenantId: t } } }),
      this.prisma.message.count({ where: { direction: 'out', internal: false, createdAt: { gte: from, lt: to }, conversation: { tenantId: t } } }),
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
      this.prisma.conversationEvent.aggregate({ where: { tenantId: t, type: 'closed', outcome: 'won', createdAt: { gte: from, lt: to } }, _count: { _all: true }, _sum: { outcomeValue: true } }),
      this.prisma.conversationEvent.count({ where: { tenantId: t, type: 'closed', outcome: 'lost', createdAt: { gte: from, lt: to } } }),
    ]);
    const respVals = firstResp.filter((r) => r.value > 0).map((r) => r.value);
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
      series: { byDay, byAgent, byOrigin, byCampaign: byCampaign.filter((c) => c.label !== '(orgânico)'), byTag: byTag.filter((c) => c.label !== '(sem tag)').sort((a, b) => b.value - a.value).slice(0, 8), byStatus },
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
    if (d.filters.tagIds?.length) filters.push(Prisma.sql`c.id in (select "conversationId" from conversation_tags where "tagId" in (${Prisma.join(d.filters.tagIds)}))`);

    const rows = await this.prisma.$queryRaw<{ label: string; value: number | null }[]>(Prisma.sql`
      select ${dim} as label, ${metric}::float as value
      from conversations c
      join whatsapp_numbers n on n.id = c."numberId"
      left join users a on a.id = c."assigneeId"
      ${vendas ? Prisma.sql`join conversation_events e on e."conversationId" = c.id and e.type = 'closed' left join users ea on ea.id = e."actorId"` : Prisma.empty}
      left join messages m on m."conversationId" = c.id
      left join conversation_tags ct on ct."conversationId" = c.id
      left join tags t on t.id = ct."tagId"
      left join lateral (
        select min(mo."createdAt") as first_out from messages mo where mo."conversationId" = c.id and mo.direction = 'out'
      ) fr on true
      where ${Prisma.join(filters, ' and ')}
      group by 1
      order by 1
    `);
    return rows.map((r) => ({ label: r.label, value: Number(r.value ?? 0) }));
  }
}

@Module({ imports: [AuthModule], controllers: [ReportsController] })
export class ReportsModule {}

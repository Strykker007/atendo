import { Prisma } from '@prisma/client';

/**
 * Vendas por consultor no período — a mesma régua para meta e ranking (docs/orcamentos.md#venda).
 *
 * Venda = encerramento "Comprou" (do ator, fora os internos) **ou** orçamento pago que ainda não
 * entrou num encerramento (do atendente que gerou o orçamento, pela data do pagamento). Quando o
 * encerramento absorve o orçamento (`budgets.closeEventId`), conta uma vez só — pelo encerramento,
 * cujo valor já inclui o pago. Estorno tira o valor: orçamento sozinho estornado sai; absorvido e
 * estornado depois desconta do encerramento.
 *
 * `eventoExtra` (ex.: filtro de tag) vale só para encerramentos — orçamento não tem tag, então com
 * o filtro ligado os pagamentos avulsos ficam de fora.
 */
export function vendasPorConsultorSql(tenantId: string, from: Date, to: Date, eventoExtra?: Prisma.Sql) {
  return Prisma.sql`
    select x.uid as "userId", count(*)::int as won, coalesce(sum(x.valor), 0)::float as revenue, count(*) filter (where x.avulso)::int as "paidOnly"
    from (
      select e."actorId" as uid, false as avulso,
             coalesce(e."outcomeValue", 0) - coalesce((select sum(b."totalValue") from budgets b where b."closeEventId" = e.id and b.status = 'REFUNDED'), 0) as valor
      from conversation_events e
      where e."tenantId" = ${tenantId} and e.type = 'closed' and e.outcome = 'won' and not e."ignoreInReports"
        and e."actorId" is not null and e."createdAt" >= ${from} and e."createdAt" < ${to}
        ${eventoExtra ? Prisma.sql`and ${eventoExtra}` : Prisma.empty}
      union all
      select b."userId" as uid, true as avulso, b."totalValue" as valor
      from budgets b
      where b."tenantId" = ${tenantId} and b.status = 'PAID' and b."closeEventId" is null
        and b."paidAt" >= ${from} and b."paidAt" < ${to}
        ${eventoExtra ? Prisma.sql`and false` : Prisma.empty}
    ) x
    group by 1`;
}

/**
 * Custo e margem por cliente (docs/36-fechamento-financeiro.md#custo-por-cliente). Regras puras:
 * como o gasto real do mês (lançado no Fechamento) é dividido entre os clientes.
 */

const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * Infraestrutura por número conectado. O pool é o lançado no mês na categoria `infra`. Número com
 * custo manual (`infraCostMonth` > 0) fica com o valor dele e sai da divisão; o resto do pool é
 * dividido igual entre os demais números. Pool menor que os manuais = os outros não pagam nada.
 */
export function allocateInfra(pool: number, numbers: { tenantId: string; manual: number }[]) {
  const manual = numbers.filter((n) => n.manual > 0);
  const auto = numbers.filter((n) => !(n.manual > 0));
  const rest = Math.max(0, pool - manual.reduce((s, n) => s + n.manual, 0));
  const perNumber = auto.length ? rest / auto.length : 0;
  const byTenant: Record<string, number> = {};
  for (const n of manual) byTenant[n.tenantId] = (byTenant[n.tenantId] ?? 0) + n.manual;
  for (const n of auto) byTenant[n.tenantId] = (byTenant[n.tenantId] ?? 0) + perNumber;
  for (const k of Object.keys(byTenant)) byTenant[k] = cents(byTenant[k]);
  return { byTenant, perNumber: cents(perNumber) };
}

/**
 * Divide um total proporcional ao que cada cliente pagou no mês. `base` é o total sobre o qual o
 * gasto incide (ex.: imposto incide sobre clientes + outras entradas): a parte das outras entradas
 * não vai para cliente nenhum.
 */
export function allocateByRevenue(total: number, received: Record<string, number>, base: number) {
  const out: Record<string, number> = {};
  if (total <= 0 || base <= 0) return out;
  for (const [id, r] of Object.entries(received)) if (r > 0) out[id] = cents((total * r) / base);
  return out;
}

export interface ClientCostRow {
  received: number;
  infra: number;
  ai: number;
  commission: number;
  taxes: number;
  fees: number;
  planCost: number;
}

/** Custo total e margem sobre o recebido. Sem receita: margem % nula (não é 0% nem −∞). */
export function marginOf(r: ClientCostRow) {
  const cost = cents(r.infra + r.ai + r.commission + r.taxes + r.fees + r.planCost);
  const margin = cents(r.received - cost);
  return { cost, margin, marginPct: r.received > 0 ? Math.round((margin / r.received) * 1000) / 10 : null };
}

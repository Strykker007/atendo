/**
 * Regras do faturamento híbrido e do painel de vencimentos (docs/empresas.md#cobrança).
 *
 * Isolado (sem Nest/Prisma/Asaas) porque decide valor, data e o que pode ser cobrado — errar
 * aqui é cobrar a mais ou deixar de cobrar, e isso não se desfaz com um deploy.
 */

export type DueCycle = 'monthly' | 'yearly';
export type DueState = 'ok' | 'due_soon' | 'overdue' | 'free';

/** Uma linha quitada por uma cobrança consolidada. Congelada em `invoices.items` na emissão. */
export interface ConsolidatedItem {
  /** `group` ou `company:<id>` — o mesmo `key` da linha do painel */
  key: string;
  kind: 'group' | 'company';
  companyId: string | null;
  label: string;
  amount: number;
  cycle: DueCycle;
  /** cobrança da assinatura do Asaas que esta substituiu (apagada no Asaas na emissão) */
  replacesPaymentId: string | null;
}

/** "A vencer" = até 7 dias. É também o filtro rápido do painel. */
export const DUE_SOON_DAYS = 7;
const DAY = 86_400_000;

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Valor de um ciclo: anual cobra 12× o equivalente mensal. `units` = empresas do grupo. */
export function amountOf(priceMonth: number, cycle: DueCycle, units = 1): number {
  return round2(priceMonth * (cycle === 'yearly' ? 12 : 1) * Math.max(1, units));
}

/**
 * Quantas unidades a assinatura do grupo cobra. Cliente INDIVIDUAL paga o plano uma vez, com
 * quantas empresas tiver. CONSOLIDATED_GROUP paga por empresa ativa que herda a assinatura —
 * nunca menos de 1, senão a holding sem unidades cadastradas não pagaria nada.
 */
export function groupUnits(tenantBillingType: 'INDIVIDUAL' | 'CONSOLIDATED_GROUP', companies: { billingType: 'INDIVIDUAL' | 'CONSOLIDATED_GROUP'; isActive: boolean }[]): number {
  if (tenantBillingType !== 'CONSOLIDATED_GROUP') return 1;
  return Math.max(1, companies.filter((c) => c.isActive && c.billingType === 'CONSOLIDATED_GROUP').length);
}

/** Próximo vencimento depois de pagar um ciclo: anda a partir do vencimento, não de hoje. */
export function nextPeriodEnd(end: Date, cycle: DueCycle): Date {
  const d = new Date(end);
  d.setMonth(d.getMonth() + (cycle === 'yearly' ? 12 : 1));
  return d;
}

export function dueState(due: Date, now = new Date()): DueState {
  if (due.getTime() < now.getTime()) return 'overdue';
  if (due.getTime() - now.getTime() <= DUE_SOON_DAYS * DAY) return 'due_soon';
  return 'ok';
}

/** Dias até o vencimento (negativo = dias de atraso), arredondado para cima. */
export const daysUntil = (due: Date, now = new Date()) => Math.ceil((due.getTime() - now.getTime()) / DAY);

/** Último instante do mês corrente no horário de Brasília. */
export function endOfMonthBrt(now = new Date()): Date {
  const brt = new Date(now.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth() + 1, 1, 3) - 1);
}

/**
 * Até quando um vencimento já pode ser pago no painel: o que vence neste mês (é o "total a
 * pagar no mês") ou nos próximos 7 dias, o que for mais longe. Sem teto, dava para pagar meses
 * adiantados e cada pagamento empurraria o vencimento mais um ciclo.
 */
export function payableUntil(now = new Date()): Date {
  return new Date(Math.max(endOfMonthBrt(now).getTime(), now.getTime() + DUE_SOON_DAYS * DAY));
}

import { mergeLimits, type BillingCycle, type PlanLimits, type PlanLimitsOverride } from '@atendo/shared';

/**
 * Personalização do plano por cliente (docs/05-planos-e-cobranca.md#personalização-por-cliente).
 *
 * Puro (sem Nest/Prisma) porque decide quanto o cliente paga e quanto pode usar: errar aqui é
 * cobrar o valor errado ou bloquear quem pagou por mais.
 */
export interface OverrideLike {
  planId: string;
  /** Decimal do Prisma ou número; null = segue o preço do plano */
  priceMonth: { toString(): string } | number | null;
  limits: unknown;
  expiresAt: Date | null;
}

/**
 * Vale agora? Só no plano em que foi feita (trocar de plano desliga: o negociado era para
 * aquele plano) e antes do fim da vigência.
 */
export function overrideActive(o: OverrideLike | null | undefined, planId: string, now = new Date()): o is OverrideLike {
  return !!o && o.planId === planId && (!o.expiresAt || o.expiresAt.getTime() > now.getTime());
}

/** Limites efetivos do cliente: os do plano, com a personalização por cima quando vale. */
export function effectiveLimits(base: PlanLimits, o: OverrideLike | null | undefined, planId: string, now = new Date()): PlanLimits {
  return overrideActive(o, planId, now) ? mergeLimits(base, o.limits as PlanLimitsOverride) : base;
}

/** Mensalidade negociada que vale agora; null = sem valor personalizado (segue o plano). */
export function overridePrice(o: OverrideLike | null | undefined, planId: string, now = new Date()): number | null {
  return overrideActive(o, planId, now) && o.priceMonth !== null ? Number(o.priceMonth) : null;
}

/** Valor de um ciclo no gateway a partir da mensalidade: anual cobra 12×, grupo cobra × unidades. */
export function cycleValue(priceMonth: number, cycle: BillingCycle, units = 1): number {
  return Math.round(priceMonth * (cycle === 'yearly' ? 12 : 1) * Math.max(1, units) * 100) / 100;
}

// ---------- Promoções (docs/05-planos-e-cobranca.md#promoções) ----------

export interface PromotionLike {
  id: string;
  discountPercent: { toString(): string } | number;
  durationMonths: number;
  planIds: string[];
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
}

/** Mensalidade com x% de desconto, em centavos inteiros. */
export function discounted(priceMonth: number, percent: number): number {
  return Math.round(priceMonth * (1 - percent / 100) * 100) / 100;
}

/** Mesma data N meses depois (o último dia do mês quando o dia não existe: 31/01 + 1 = 28/02). */
export function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  const dia = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  out.setDate(Math.min(dia, new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()));
  return out;
}

/**
 * Promoção que este cliente ganha ao assinar `planId` agora, ou null. Não acumula: quem já tem
 * personalização valendo NESTE plano (negociada ou outra promoção) fica com ela; e quem já
 * aproveitou esta promoção não aproveita de novo trocando de plano.
 */
export function promotionFor<P extends PromotionLike>(
  promos: P[],
  planId: string,
  current: (OverrideLike & { promotionId: string | null }) | null | undefined,
  now = new Date(),
): P | null {
  // boolean solto: o type guard estreitaria `current` para null no resto da função
  const jaTem: boolean = overrideActive(current, planId, now);
  if (jaTem) return null;
  const abertas = promos.filter((p) => p.isActive && p.planIds.includes(planId) && p.startsAt <= now && p.endsAt > now && current?.promotionId !== p.id);
  // mais de uma valendo para o plano: a maior, que é a que o cliente viu anunciada
  return abertas.sort((a, b) => Number(b.discountPercent) - Number(a.discountPercent))[0] ?? null;
}

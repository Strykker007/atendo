import type { BillingCycle } from '@atendo/shared';

/** O que chega do formulário de planos, já validado pelo DTO. `L` = o objeto de limites. */
export interface PlanInput<L extends object> {
  priceMonth: number;
  priceYear?: number | null;
  isFree?: boolean;
  billingCycle?: BillingCycle;
  durationDays?: number | null;
  billingModel: 'fixed' | 'usage' | 'hybrid';
  limits: L;
}

/**
 * Normaliza os campos de cobrança de um plano. Puro, para testar sem banco.
 *
 * - `isFree` e `billingCycle = free` são a mesma coisa: qualquer um dos dois liga o outro.
 * - Gratuito zera preço e **trava a quota** (sem excedente): plano sem fatura não tem onde
 *   cobrar excedente, e deixar `hardLimit: false` viraria uso de graça sem limite.
 * - Anual guarda o equivalente mensal em `priceMonth` — MRR e margem somam mensal com mensal.
 */
export function normalizePlan<L extends object>(dto: PlanInput<L>) {
  const billingCycle: BillingCycle = dto.isFree ? 'free' : (dto.billingCycle ?? 'monthly');
  const isFree = billingCycle === 'free';
  if (isFree) {
    return {
      isFree,
      billingCycle,
      priceMonth: 0,
      priceYear: null,
      durationDays: dto.durationDays ?? null,
      billingModel: 'fixed' as const,
      limits: {
        ...dto.limits,
        hardLimit: true,
        overagePricePerMessage: null,
        overagePricePerTemplate: null,
        overagePricePerConversation: null,
        overagePricePerAiInteraction: null,
      },
    };
  }
  const priceYear = billingCycle === 'yearly' ? (dto.priceYear ?? 0) : null;
  return {
    isFree,
    billingCycle,
    priceMonth: priceYear !== null ? Math.round((priceYear / 12) * 100) / 100 : dto.priceMonth,
    priceYear,
    durationDays: null,
    billingModel: dto.billingModel,
    limits: dto.limits,
  };
}

const DAY = 86_400_000;

/**
 * Período de uma assinatura gratuita que começa agora. Com prazo, termina no fim da
 * degustação; permanente, é um mês que o job diário vai rolando (só para a tela ter uma data).
 */
export function freePeriod(durationDays: number | null, now = new Date()) {
  if (durationDays) return { start: now, end: new Date(now.getTime() + durationDays * DAY) };
  const end = new Date(now);
  end.setMonth(end.getMonth() + 1);
  return { start: now, end };
}

/** Empurra um período mensal vencido para frente até cobrir `now`. */
export function rollMonthly(start: Date, end: Date, now = new Date()) {
  const s = new Date(start);
  const e = new Date(end);
  while (e <= now) {
    s.setTime(e.getTime());
    e.setMonth(e.getMonth() + 1);
  }
  return { start: s, end: e };
}

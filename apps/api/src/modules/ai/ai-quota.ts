import type { PlanLimits } from '@atendo/shared';

export interface AiQuotaDecision {
  ok: boolean;
  reason?: string;
  /** passou do incluído e será cobrado como excedente na fatura */
  overage?: boolean;
}

export interface AiUsageSnapshot {
  /** interações já usadas no mês */
  interactions: number;
  /** custo real acumulado no mês, em BRL */
  costBrl: number;
}

/**
 * Decide se o tenant pode fazer mais uma chamada de IA. Puro.
 *
 * Duas travas diferentes de propósito: a **quota** protege o cliente de uma fatura
 * surpresa; o **teto de custo** protege você. Mensagem tem custo previsível por unidade;
 * IA não — um fluxo mal feito pode chamar o modelo em loop.
 */
export function decideCanUseAi(
  plan: { limits: PlanLimits; status: string } | null,
  used: AiUsageSnapshot,
): AiQuotaDecision {
  if (!plan) return { ok: false, reason: 'Sem assinatura ativa' };
  if (plan.status === 'suspended' || plan.status === 'canceled') return { ok: false, reason: 'Assinatura suspensa' };

  const cap = plan.limits.aiMonthlyCostCap ?? 0;
  if (cap > 0 && used.costBrl >= cap) {
    return { ok: false, reason: 'Teto de gasto com IA do mês atingido. Fale com o suporte para aumentar.' };
  }

  const included = plan.limits.includedAiInteractionsMonth ?? 0;
  const overagePrice = plan.limits.overagePricePerAiInteraction ?? null;

  if (used.interactions < included) return { ok: true };
  if (overagePrice !== null) return { ok: true, overage: true };
  return {
    ok: false,
    reason: included
      ? `Limite de interações de IA do plano atingido (${included}/mês)`
      : 'IA não incluída no seu plano',
  };
}

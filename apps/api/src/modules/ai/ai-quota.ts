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

/** Faixas do orçamento da plataforma que disparam alerta por e-mail (uma vez por mês cada). */
export const PLATFORM_ALERT_LEVELS = [50, 80, 100] as const;

/**
 * Orçamento global de IA: o gasto de **todos** os tenants somados contra o crédito da conta
 * do fornecedor. Puro. `budgetBrl` 0 = sem orçamento (não bloqueia nem alerta).
 *
 * É a trava que protege o dono da chave: o teto por tenant não impede que 200 clientes,
 * cada um dentro do próprio teto, somem uma fatura que ninguém planejou.
 */
export function platformBudgetStatus(spentBrl: number, budgetBrl: number) {
  if (!budgetBrl) return { blocked: false, level: null as number | null };
  const pct = (spentBrl / budgetBrl) * 100;
  const level = [...PLATFORM_ALERT_LEVELS].reverse().find((l) => pct >= l) ?? null;
  return { blocked: pct >= 100, level };
}

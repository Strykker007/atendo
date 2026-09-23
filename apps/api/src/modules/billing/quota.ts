import type { PlanLimits } from '@atendo/shared';

export type QuotaKind = 'messages' | 'templates';
export interface QuotaDecision {
  ok: boolean;
  reason?: string;
  /** true = passou do incluído e será cobrado como excedente na fatura */
  overage?: boolean;
}

/**
 * Decide se o tenant pode enviar mais uma mensagem/template. Puro: o ledger e o
 * Redis ficam no UsageService. É a regra que evita tanto prejuízo quanto bloqueio indevido.
 */
export function decideCanSend(
  plan: { limits: PlanLimits; status: string } | null,
  used: Record<QuotaKind, number>,
  kind: QuotaKind,
): QuotaDecision {
  if (!plan) return { ok: false, reason: 'Sem assinatura ativa' };
  if (plan.status === 'suspended' || plan.status === 'canceled') return { ok: false, reason: 'Assinatura suspensa' };

  const included = kind === 'messages' ? plan.limits.includedMessagesMonth : plan.limits.includedTemplatesMonth;
  const overage = kind === 'messages' ? plan.limits.overagePricePerMessage : plan.limits.overagePricePerTemplate;

  if (used[kind] < included) return { ok: true };
  if (!plan.limits.hardLimit && overage !== null) return { ok: true, overage: true };
  return { ok: false, reason: `Limite de ${kind === 'messages' ? 'mensagens' : 'templates'} do plano atingido (${included}/mês)` };
}

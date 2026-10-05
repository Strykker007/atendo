import type { BillingUnit, PlanLimits } from '@atendo/shared';

export type QuotaKind = 'messages' | 'templates' | 'conversations';
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
/** Unidade que limita este plano. Ausente = mensagens (planos criados antes da opção). */
export const unitOf = (limits: PlanLimits): BillingUnit => limits.billingUnit ?? 'messages';

const LABEL: Record<QuotaKind, string> = { messages: 'mensagens', templates: 'templates', conversations: 'conversas' };

/** `included` null = ilimitado (o plano não tem teto para esta unidade). */
function limitsFor(limits: PlanLimits, kind: QuotaKind): { included: number | null; overage: number | null } {
  if (kind === 'templates') return { included: limits.includedTemplatesMonth, overage: limits.overagePricePerTemplate };
  if (kind === 'conversations') return { included: limits.includedConversationsMonth === undefined ? 0 : limits.includedConversationsMonth, overage: limits.overagePricePerConversation ?? null };
  return { included: limits.includedMessagesMonth, overage: limits.overagePricePerMessage };
}

export function decideCanSend(
  plan: { limits: PlanLimits; status: string } | null,
  used: Record<QuotaKind, number>,
  kind: QuotaKind,
): QuotaDecision {
  if (!plan) return { ok: false, reason: 'Sem assinatura ativa' };
  if (plan.status === 'suspended' || plan.status === 'canceled') return { ok: false, reason: 'Assinatura suspensa' };

  // template tem limite próprio; fora isso, quem limita é a unidade do plano — o ledger
  // registra mensagens E conversas sempre, mas só uma delas bloqueia o envio
  const efetiva: QuotaKind = kind === 'templates' ? 'templates' : unitOf(plan.limits);
  const { included, overage } = limitsFor(plan.limits, efetiva);

  if (included === null || (used[efetiva] ?? 0) < included) return { ok: true };
  if (!plan.limits.hardLimit && overage !== null) return { ok: true, overage: true };
  return { ok: false, reason: `Limite de ${LABEL[efetiva]} do plano atingido (${included}/mês)` };
}

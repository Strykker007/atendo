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

export interface QuotaStatus {
  /** unidade que limita o plano (o banner fala dela, não de mensagens por padrão) */
  unit: BillingUnit;
  /** maior uso/incluído entre a unidade do plano e os templates; null = nada com teto (ilimitado) */
  ratio: number | null;
  /** qual métrica deu o `ratio` */
  metric: QuotaKind | null;
  /** resposta comum (fora de template) recusada — mesma decisão do envio */
  blocked: boolean;
  /** motivo do bloqueio, o mesmo texto que o envio devolve */
  reason: string | null;
  /** template recusado (limite próprio) */
  templatesBlocked: boolean;
  /** passou do incluído e o excedente vai para a fatura */
  overage: boolean;
}

/**
 * Situação da quota para a tela (banner, caixa de resposta). Sai da MESMA regra do envio
 * (`decideCanSend`/`limitsFor`): calcular no front a partir de `includedMessagesMonth`
 * mostrava "92% do plano" para quem é cobrado por conversa (e ilimitado).
 */
export function quotaStatus(plan: { limits: PlanLimits; status: string } | null, used: Record<QuotaKind, number>): QuotaStatus | null {
  if (!plan) return null;
  const unit = unitOf(plan.limits);
  let ratio: number | null = null;
  let metric: QuotaKind | null = null;
  for (const kind of [unit, 'templates'] as const) {
    const { included } = limitsFor(plan.limits, kind);
    if (!included) continue; // null = ilimitado; 0 = tudo é excedente/bloqueio, sem percentual
    const r = (used[kind] ?? 0) / included;
    if (ratio === null || r > ratio) { ratio = r; metric = kind; }
  }
  const msg = decideCanSend(plan, used, unit);
  const tpl = decideCanSend(plan, used, 'templates');
  return { unit, ratio, metric, blocked: !msg.ok, reason: msg.ok ? null : msg.reason ?? null, templatesBlocked: !tpl.ok, overage: !!msg.overage || !!tpl.overage };
}

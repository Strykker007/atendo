export const BillingModel = { FIXED: 'fixed', USAGE: 'usage', HYBRID: 'hybrid' } as const;
export type BillingModel = (typeof BillingModel)[keyof typeof BillingModel];

/** Limites de um plano. Vive em jsonb para você criar planos sem migration. */
export interface PlanLimits {
  maxNumbers: number;
  maxAgents: number;
  /** mensagens ENVIADAS incluídas/mês (o que gera custo/infra) */
  includedMessagesMonth: number;
  /** templates Meta incluídos/mês — nunca ilimitado em plano fixo */
  includedTemplatesMonth: number;
  /** null = bloqueia ao estourar; número = cobra excedente por mensagem */
  overagePricePerMessage: number | null;
  overagePricePerTemplate: number | null;
  hardLimit: boolean;
  /** dias de tolerância após falha de pagamento antes de suspender */
  graceDays: number;
}

export const USAGE_ALERT_THRESHOLDS = [0.8, 1.0] as const;

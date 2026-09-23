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
  /** Funcionalidades plugáveis liberadas neste plano (ex.: 'flows'). Ausente = nenhuma. */
  features?: PlanFeature[];
  // ---- IA (opcional: planos antigos no banco não têm estes campos) ----
  /** interações de IA incluídas/mês. Ausente ou 0 = nenhuma */
  includedAiInteractionsMonth?: number;
  /** null/ausente = bloqueia ao estourar; número = cobra excedente por interação */
  overagePricePerAiInteraction?: number | null;
  /**
   * Teto de custo REAL de IA no mês (BRL). Corta o uso mesmo que o cliente esteja pagando
   * excedente — diferente de mensagem, a IA pode entrar em loop e queimar dinheiro em minutos.
   */
  aiMonthlyCostCap?: number;
}

export const PlanFeature = { FLOWS: 'flows', SCHEDULING: 'scheduling', AI_FLOWS: 'ai_flows', AI_COPILOT: 'ai_copilot' } as const;
export type PlanFeature = (typeof PlanFeature)[keyof typeof PlanFeature];
export const PLAN_FEATURE_LABEL: Record<PlanFeature, string> = {
  flows: 'Fluxos de automação',
  scheduling: 'Agendamento',
  ai_flows: 'IA nos fluxos',
  ai_copilot: 'Copiloto de IA',
};

export const USAGE_ALERT_THRESHOLDS = [0.8, 1.0] as const;

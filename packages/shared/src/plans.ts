export const BillingModel = { FIXED: 'fixed', USAGE: 'usage', HYBRID: 'hybrid' } as const;
export type BillingModel = (typeof BillingModel)[keyof typeof BillingModel];

/** Unidade cobrada do cliente. Mensagem é previsível; conversa é como a Meta cobra. */
export const BillingUnit = { MESSAGES: 'messages', CONVERSATIONS: 'conversations' } as const;
export type BillingUnit = (typeof BillingUnit)[keyof typeof BillingUnit];
export const BILLING_UNIT_LABEL: Record<BillingUnit, string> = { messages: 'mensagens enviadas', conversations: 'conversas' };

/**
 * Modalidade de cobrança do plano. `free` = sem gateway nem fatura (cortesia, degustação,
 * freemium); `custom` = valor negociado e cobrado por fora do Stripe (o dono atribui à mão).
 */
export const BillingCycle = { FREE: 'free', MONTHLY: 'monthly', YEARLY: 'yearly', CUSTOM: 'custom' } as const;
export type BillingCycle = (typeof BillingCycle)[keyof typeof BillingCycle];
export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = { free: 'Gratuito', monthly: 'Mensal', yearly: 'Anual', custom: 'Personalizado' };
/** Só estas modalidades viram preço recorrente no Stripe e podem ir para o checkout. */
export const isStripeBillable = (cycle: BillingCycle) => cycle === 'monthly' || cycle === 'yearly';

/** Limites de um plano. Vive em jsonb para você criar planos sem migration. */
export interface PlanLimits {
  /** números de WhatsApp (conexões). `null` = ilimitado */
  maxNumbers: number | null;
  /** atendentes/gerentes ativos. `null` = ilimitado */
  maxAgents: number | null;
  /** fluxos ATIVOS ao mesmo tempo (rascunho desativado não conta). Ausente/`null` = ilimitado */
  maxFlows?: number | null;
  /** respostas rápidas cadastradas. Ausente/`null` = ilimitado */
  maxQuickReplies?: number | null;
  /** empresas/unidades cadastradas (docs/empresas.md). Ausente/`null` = ilimitado */
  maxCompanies?: number | null;
  /**
   * Qual unidade conta para a quota deste plano. Ausente = `messages` (planos antigos).
   * O ledger registra **as duas** sempre; isto decide qual limita e qual vira excedente.
   */
  billingUnit?: BillingUnit;
  /** mensagens ENVIADAS incluídas/mês (o que gera custo/infra). `null` = ilimitado */
  includedMessagesMonth: number | null;
  /**
   * conversas incluídas/mês — uma conversa é uma janela de 24h com o mesmo contato.
   * `null` = ilimitado; **ausente = 0** (planos antigos, que limitavam por mensagem)
   */
  includedConversationsMonth?: number | null;
  overagePricePerConversation?: number | null;
  /**
   * templates Meta incluídos/mês. `null` = ilimitado — cuidado: cada template custa à Meta,
   * então ilimitado em plano fixo é custo sem teto
   */
  includedTemplatesMonth: number | null;
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

export const PlanFeature = { FLOWS: 'flows', SCHEDULING: 'scheduling', AI_FLOWS: 'ai_flows', AI_COPILOT: 'ai_copilot', CAMPAIGNS: 'campaigns' } as const;
export type PlanFeature = (typeof PlanFeature)[keyof typeof PlanFeature];
/** Lista fechada, para validar o que vem do formulário de planos. */
export const PLAN_FEATURES = Object.values(PlanFeature);

export const PLAN_FEATURE_LABEL: Record<PlanFeature, string> = {
  flows: 'Fluxos de automação',
  scheduling: 'Agendamento',
  ai_flows: 'IA nos fluxos',
  ai_copilot: 'Copiloto de IA',
  campaigns: 'Transmissão em massa',
};

/** Limites de quantidade checados na criação/ativação (ver `PlanLimitGuard` na API). */
export type CountLimit = 'maxNumbers' | 'maxAgents' | 'maxFlows' | 'maxQuickReplies' | 'maxCompanies';
export const COUNT_LIMIT_LABEL: Record<CountLimit, string> = { maxNumbers: 'números de WhatsApp', maxAgents: 'usuários', maxFlows: 'fluxos ativos', maxQuickReplies: 'respostas rápidas', maxCompanies: 'empresas' };
/** Teto do limite; `null` = ilimitado. Campo ausente (plano antigo) também é ilimitado. */
export const countLimit = (limits: PlanLimits, key: CountLimit): number | null => {
  const v = limits[key];
  return v === undefined || v === null ? null : Number(v);
};

export const USAGE_ALERT_THRESHOLDS = [0.8, 1.0] as const;

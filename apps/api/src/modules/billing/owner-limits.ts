import { PLAN_FEATURES, type PlanLimits } from '@atendo/shared';

/** Base para empresa de dono sem assinatura: só os campos obrigatórios, o resto vem de `ownerLimits`. */
const NO_PLAN: PlanLimits = {
  maxNumbers: 0,
  maxAgents: 0,
  includedMessagesMonth: 0,
  includedTemplatesMonth: 0,
  overagePricePerMessage: null,
  overagePricePerTemplate: null,
  hardLimit: true,
  graceDays: 5,
};

/**
 * Empresa de um dono do sistema (docs/donos-do-sistema.md#acesso-amplo): todos os recursos e nenhum
 * limite de quantidade, de quota de envio ou de interações de IA, qualquer que seja o plano. Fica
 * só o teto de custo de IA do plano (`aiMonthlyCostCap`): ele protege a plataforma de um fluxo em
 * loop, não o cliente de uma fatura.
 */
export function ownerLimits(base: PlanLimits | null): PlanLimits {
  return {
    ...(base ?? NO_PLAN),
    maxNumbers: null,
    maxAgents: null,
    maxFlows: null,
    maxQuickReplies: null,
    maxCompanies: null,
    includedMessagesMonth: null,
    includedConversationsMonth: null,
    includedTemplatesMonth: null,
    hardLimit: false,
    features: [...PLAN_FEATURES],
    includedAiInteractionsMonth: Number.MAX_SAFE_INTEGER,
  };
}

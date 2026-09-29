/**
 * Qual fluxo padrão do cliente deve disparar numa mensagem recebida.
 *
 * Roda **depois** dos gatilhos próprios dos fluxos (palavra-chave e conversa nova): o que o
 * cliente configurou explicitamente para aquela palavra sempre ganha do padrão.
 */

export type DefaultFlowKind = 'welcome' | 'closed' | 'default';

export interface DefaultFlowSettings {
  welcomeFlowId?: string | null;
  closedFlowId?: string | null;
  defaultFlowId?: string | null;
  defaultFlowInactivityHours: number;
}

export interface InboundSituation {
  /** primeira mensagem deste contato — nunca conversou antes */
  isNewContact: boolean;
  /** voltou a escrever depois de o atendimento anterior ter sido encerrado */
  returningAfterClosed: boolean;
  /** horas desde a última mensagem da conversa; null = não havia mensagem anterior */
  hoursSinceLastMessage: number | null;
}

/**
 * Ordem: boas-vindas (contato novo) → conversa finalizada (voltou) → resposta padrão.
 *
 * A resposta padrão só dispara **após o período de inatividade** — senão o robô
 * responderia a cada mensagem de uma conversa em andamento, por cima do atendente.
 */
export function pickDefaultFlow(situation: InboundSituation, settings: DefaultFlowSettings): { kind: DefaultFlowKind; flowId: string } | null {
  if (situation.isNewContact && settings.welcomeFlowId) {
    return { kind: 'welcome', flowId: settings.welcomeFlowId };
  }
  if (situation.returningAfterClosed && settings.closedFlowId) {
    return { kind: 'closed', flowId: settings.closedFlowId };
  }
  if (settings.defaultFlowId) {
    const horas = situation.hoursSinceLastMessage;
    if (horas === null || horas >= Math.max(0, settings.defaultFlowInactivityHours)) {
      return { kind: 'default', flowId: settings.defaultFlowId };
    }
  }
  return null;
}

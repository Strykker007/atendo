import type { BandBehavior, BandReplyKind } from '@atendo/shared';

/**
 * O que fazer com uma mensagem recebida conforme a faixa de horário atual (docs/horarios.md).
 * Puro, para testar a matriz sem banco. O envio único por período fica no motor (a decisão aqui
 * é "tentar enviar"; quem já recebeu naquele período não recebe de novo).
 */
export interface InboundPlan {
  /** enviar boas-vindas (atendimento novo) antes de tudo */
  welcome: boolean;
  /** enviar a resposta da faixa antes do atendimento normal */
  notifyFirst: boolean;
  /** seguir o atendimento normal (run ativo, gatilhos, fluxos padrão) */
  proceed: boolean;
  /** enviar a resposta da faixa só se nenhum fluxo respondeu */
  notifyIfUnhandled: boolean;
}

/**
 * Boas-vindas não repetem para quem conversou há menos disto (docs/horarios.md): o contato que
 * volta uma hora depois de encerrado recebia a mesma saudação de novo — texto idêntico de robô
 * repetido para a mesma pessoa é sinal de spam para o WhatsApp. O resto do atendimento segue.
 */
export const WELCOME_COOLDOWN_HOURS = 6;

export function planInbound(i: { behavior: BandBehavior; reply: BandReplyKind; paused: boolean; newAttendance: boolean; activeRun: boolean; /** horas desde a última mensagem com o contato; null = primeira vez */ hoursSinceLastMessage?: number | null }): InboundPlan {
  const plan = planBand(i);
  if (plan.welcome && i.hoursSinceLastMessage != null && i.hoursSinceLastMessage < WELCOME_COOLDOWN_HOURS) return { ...plan, welcome: false };
  return plan;
}

function planBand(i: { behavior: BandBehavior; reply: BandReplyKind; paused: boolean; newAttendance: boolean; activeRun: boolean }): InboundPlan {
  // robô pausado: só a mensagem da faixa continua (não inicia fluxo, não manda boas-vindas)
  if (i.paused) return { welcome: false, notifyFirst: i.behavior !== 'normal' && i.reply === 'message', proceed: false, notifyIfUnhandled: false };
  switch (i.behavior) {
    // parar: só a resposta da faixa — sem boas-vindas (fechado → só a mensagem de fechado)
    case 'notify_stop':
      return { welcome: false, notifyFirst: true, proceed: false, notifyIfUnhandled: false };
    // fluxo da faixa não interrompe quem já está no meio de outro fluxo
    case 'notify_continue':
      return { welcome: i.newAttendance, notifyFirst: !(i.reply === 'flow' && i.activeRun), proceed: true, notifyIfUnhandled: false };
    case 'notify_fallback':
      return { welcome: i.newAttendance, notifyFirst: false, proceed: true, notifyIfUnhandled: true };
    default:
      return { welcome: i.newAttendance, notifyFirst: false, proceed: true, notifyIfUnhandled: false };
  }
}

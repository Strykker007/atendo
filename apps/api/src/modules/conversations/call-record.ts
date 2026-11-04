import type { CallStatus } from '../whatsapp/providers/provider.interface';

/**
 * Ligação registrada na conversa (docs/ligacoes.md): uma linha `type: 'call'` por ligação, que
 * muda de desfecho conforme os eventos chegam. Regras puras aqui; quem grava é `InboundService.applyCall`.
 */
export type CallOutcome = 'ringing' | 'answered' | 'missed' | 'rejected';

export interface CallContent {
  kind: 'call';
  isVideo: boolean;
  outcome: CallOutcome;
}

/** `externalId` da linha: prefixo para nunca colidir com id de mensagem do WhatsApp no mesmo número */
export const callExternalId = (callId: string) => `call:${callId}`;

/**
 * Desfecho depois do evento. Desfecho final não muda mais: o `terminate` que vem depois do
 * `accept` (desligou depois de falar) não transforma a atendida em perdida.
 */
export function desfechoDaLigacao(antes: CallOutcome | undefined, status: CallStatus): CallOutcome {
  if (antes && antes !== 'ringing') return antes;
  if (status === 'accept') return 'answered';
  if (status === 'reject') return 'rejected';
  if (status === 'timeout' || status === 'terminate') return 'missed';
  return 'ringing';
}

/** Perdida ou recusada: o cliente ficou sem resposta — conta como mensagem nova (não lida, fila). */
export const ficouSemResposta = (o: CallOutcome) => o === 'missed' || o === 'rejected';

/** Texto da linha e da prévia na lista de conversas. */
export function textoDaLigacao(isVideo: boolean, outcome: CallOutcome): string {
  const tipo = isVideo ? '📹 Chamada de vídeo' : '📞 Ligação de voz';
  const fim: Record<CallOutcome, string> = { ringing: 'recebida', answered: 'atendida no celular', missed: 'perdida', rejected: 'recusada' };
  return `${tipo} ${fim[outcome]}`;
}

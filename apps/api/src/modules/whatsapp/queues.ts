export const QUEUE_INBOUND = 'wa-inbound';
export const QUEUE_OUTBOUND = 'wa-outbound';
export const QUEUE_BILLING = 'billing';

export interface InboundJob {
  provider: 'meta' | 'evolution';
  body: unknown;
}
export interface OutboundJob {
  messageId: string;
  /**
   * Instante (epoch ms) da vaga já reservada no ritmo de envio. Preenchido quando o job é
   * adiado pela proteção do número: sem isto, cada reentrada reservaria uma vaga nova e o
   * job se empurraria para frente para sempre, sem nunca enviar.
   */
  pacedUntil?: number;
  /**
   * Piso (ms) entre a ENTREGA da mensagem anterior da conversa e esta: o atraso do bloco
   * Conteúdo ("esperar X s antes desta"). Soma-se ao ritmo do número como o maior dos dois.
   */
  minGapMs?: number;
  /** automático: o tempo de reação (humanTiming) já foi esperado — não espera de novo nas reentradas */
  reacted?: boolean;
}

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
}

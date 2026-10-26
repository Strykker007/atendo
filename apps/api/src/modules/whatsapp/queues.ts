export const QUEUE_INBOUND = 'wa-inbound';
export const QUEUE_OUTBOUND = 'wa-outbound';
export const QUEUE_BILLING = 'billing';
/** recuperação do que o número não recebeu ao vivo (whatsapp/gap-recovery.ts) */
export const QUEUE_GAP_RECOVERY = 'wa-gap-recovery';

export interface GapRecoveryJob {
  numberId: string;
}

/**
 * Depois de reconectar o WhatsApp manda o atraso em lotes, e o lote de histórico do QR leva
 * minutos para chegar ao banco da Evolution: uma rodada logo e outra mais tarde. Repetir é seguro
 * (a mesma mensagem nunca entra duas vezes).
 */
export const GAP_RECOVERY_DELAYS_MS = [3 * 60_000, 15 * 60_000];

export interface InboundJob {
  provider: 'meta' | 'evolution';
  body: unknown;
  /** quando o webhook chegou (epoch ms, nosso relógio) — ordem dos connection.update (connection-events.ts) */
  receivedAt?: number;
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
  /**
   * Automática liberada porque um atendente está esperando atrás dela na conversa (`releaseHeld`):
   * reserva vaga sem o teto de automáticas/h. O espaçamento do número continua valendo.
   */
  released?: boolean;
}

import type { InboundMessage, OutboundMessage, SendResult, StatusUpdate, NumberStatus } from '@atendo/shared';

/** Como o número está configurado no provider (descriptografado do banco). */
export interface NumberContext {
  numberId: string;
  tenantId: string;
  phone: string;
  externalId: string;
  config: Record<string, unknown>;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  /** mudanças de conexão (QR lido, desconectou) */
  connection?: { externalNumberId: string; status: NumberStatus; qrCode?: string };
}

/**
 * Contrato único. UI, banco e filas só conhecem esta interface.
 * Trocar Meta <-> Evolution = trocar o campo `provider` do número.
 */
export interface WhatsAppProvider {
  readonly kind: 'meta' | 'evolution';

  /** Cria/registra o número no provider e devolve o que for necessário (QR, status). */
  connect(ctx: NumberContext): Promise<{ status: NumberStatus; qrCode?: string }>;
  disconnect(ctx: NumberContext): Promise<void>;
  getStatus(ctx: NumberContext): Promise<NumberStatus>;

  send(ctx: NumberContext, message: OutboundMessage): Promise<SendResult>;
  markRead(ctx: NumberContext, externalMessageId: string): Promise<void>;

  /** Valida assinatura/autenticidade do webhook. Lança se inválido. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): void;
  parseWebhook(body: unknown): ParsedWebhook;
}

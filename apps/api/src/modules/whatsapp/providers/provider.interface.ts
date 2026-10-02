import type { InboundMessage, OutboundMessage, SendResult, StatusUpdate, NumberStatus } from '@atendo/shared';

/** Como o número está configurado no provider (descriptografado do banco). */
export interface NumberContext {
  numberId: string;
  tenantId: string;
  phone: string;
  externalId: string;
  config: Record<string, unknown>;
}

export interface MediaPayload {
  data: Buffer;
  mimeType: string;
  fileName?: string;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  /** mudanças de conexão (QR lido, desconectou) */
  connection?: {
    externalNumberId: string;
    status: NumberStatus;
    qrCode?: string;
    /** telefone real que conectou (E.164 sem +), quando o provider informa */
    phone?: string;
    /** true = estado intermediário (ex.: 'connecting' logo após parear) — não deve derrubar um número conectado */
    transient?: boolean;
    /** true = o celular removeu o dispositivo / sessão encerrada; precisa de QR novo */
    loggedOut?: boolean;
  };
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
  /** Remove definitivamente o número do provider (ex.: apaga a instância na Evolution). Opcional. */
  destroy?(ctx: NumberContext): Promise<void>;
  /** Reinicia a sessão sem novo pareamento (Evolution: socket zumbi). Opcional. */
  restart?(ctx: NumberContext): Promise<void>;
  getStatus(ctx: NumberContext): Promise<NumberStatus>;

  /**
   * `media.data` (Buffer) é preenchido pelo OutboundProcessor a partir do storage —
   * o provider nunca precisa de URL pública.
   */
  send(ctx: NumberContext, message: OutboundMessage, media?: MediaPayload): Promise<SendResult>;
  /** Baixa a mídia de uma mensagem recebida (id/raw vêm do InboundMessage). */
  fetchMedia(ctx: NumberContext, message: InboundMessage): Promise<MediaPayload | null>;
  /**
   * Foto de perfil do contato. Opcional: a API oficial da Meta não expõe isto, então só a
   * Evolution implementa. Devolve `null` quando o contato não tem foto ou a esconde.
   */
  fetchProfilePicture?(ctx: NumberContext, phone: string): Promise<MediaPayload | null>;
  markRead(ctx: NumberContext, externalMessageId: string): Promise<void>;

  /** Valida assinatura/autenticidade do webhook. Lança se inválido. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): void;
  parseWebhook(body: unknown): ParsedWebhook;
}

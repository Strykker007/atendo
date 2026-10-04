/** Qual integração está por trás de um número. A troca é só este valor. */
export const WhatsAppProviderKind = { META: 'meta', EVOLUTION: 'evolution' } as const;
export type WhatsAppProviderKind = (typeof WhatsAppProviderKind)[keyof typeof WhatsAppProviderKind];

export const NumberStatus = {
  CONNECTED: 'connected',
  PENDING_QR: 'pending_qr',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
} as const;
export type NumberStatus = (typeof NumberStatus)[keyof typeof NumberStatus];

/** Filtro principal, sempre visível acima da lista de conversas. */
export const ConversationStatus = {
  WAITING: 'waiting',
  IN_PROGRESS: 'in_progress',
  CLOSED: 'closed',
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

export const MessageDirection = { IN: 'in', OUT: 'out' } as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

export const MessageType = {
  TEXT: 'text',
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
  DOCUMENT: 'document',
  STICKER: 'sticker',
  LOCATION: 'location',
  CONTACT: 'contact',
  TEMPLATE: 'template',
  /** botões, template com botões ou lista/menu — o desenho vem em `MessageDTO.content` */
  INTERACTIVE: 'interactive',
  /** último recurso: nem o fallback de texto achou o que mostrar. A UI nunca exibe a palavra crua. */
  UNKNOWN: 'unknown',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const MessageStatus = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/**
 * Categoria de cobrança da Meta. `service` (resposta livre na janela de 24h) é grátis;
 * as demais são templates e custam por mensagem entregue. `unofficial` = Evolution, custo 0.
 */
export const BillingCategory = {
  SERVICE: 'service',
  UTILITY: 'utility',
  MARKETING: 'marketing',
  AUTHENTICATION: 'authentication',
  UNOFFICIAL: 'unofficial',
} as const;
export type BillingCategory = (typeof BillingCategory)[keyof typeof BillingCategory];

/** Origem da conversa. `ad` vem de referral do provider; os outros são inferidos/manual. */
export const ConversationOrigin = {
  ORGANIC: 'organic', // contato mandou mensagem por conta própria
  AD: 'ad', // anúncio Click-to-WhatsApp (Instagram/Facebook)
  POST: 'post', // publicação com botão de WhatsApp
  LINK: 'link', // link wa.me / botão em site
} as const;
export type ConversationOrigin = (typeof ConversationOrigin)[keyof typeof ConversationOrigin];

export const Role = {
  SUPER_ADMIN: 'super_admin', // dono do Atendo
  TENANT_ADMIN: 'tenant_admin', // admin do cliente
  MANAGER: 'manager', // gerente: coordena atendentes
  AGENT: 'agent', // atendente
} as const;
export type Role = (typeof Role)[keyof typeof Role];

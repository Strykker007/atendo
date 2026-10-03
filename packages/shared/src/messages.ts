import type { BillingCategory, MessageDirection, MessageStatus, MessageType, WhatsAppProviderKind } from './enums.js';

/** Formato canônico: tudo que entra de qualquer provider vira isto. */
export interface InboundMessage {
  provider: WhatsAppProviderKind;
  /** id da mensagem no provider (idempotência do webhook) */
  externalId: string;
  /** identificador do número do tenant no provider (phone_number_id ou instanceName) */
  externalNumberId: string;
  /** telefone do contato em E.164 */
  from: string;
  /**
   * Mensagem que SAIU do número do cliente. Acontece quando ele responde pelo celular em vez
   * do painel — o WhatsApp manda o mesmo evento, com esta marca. Precisa entrar no histórico,
   * senão o painel mostra só metade da conversa.
   */
  fromMe?: boolean;
  contactName?: string;
  type: MessageType;
  text?: string;
  media?: { url?: string; mimeType?: string; fileName?: string; caption?: string; providerMediaId?: string };
  location?: { lat: number; lng: number; name?: string };
  quotedExternalId?: string;
  /** texto do que foi citado, quando a citada não é uma mensagem nossa (resposta a status) */
  quotedPreview?: string;
  /** a citação era um status/story (some em 24h, não é mensagem da conversa) */
  quotedFromStatus?: boolean;
  /** id da opção escolhida num menu interativo (botão/lista), quando o provider informa */
  interactiveReplyId?: string;
  /** De onde o lead veio, quando o provider informa (anúncio Click-to-WhatsApp, link com contexto). */
  referral?: LeadReferral;
  timestamp: Date;
  raw: unknown;
}

export interface LeadReferral {
  /** 'ad' = anúncio Meta (Instagram/Facebook), 'post' = publicação, 'link' = wa.me com contexto */
  sourceType: 'ad' | 'post' | 'link' | 'unknown';
  /** id do anúncio/publicação */
  sourceId?: string;
  sourceUrl?: string;
  /** título do anúncio */
  headline?: string;
  body?: string;
  /** click-to-WhatsApp click id (Meta) — permite conversão de volta no Ads Manager */
  ctwaClid?: string;
  /** imagem/vídeo do anúncio */
  mediaUrl?: string;
}

/** Formato canônico de saída: a UI monta isto, o adapter traduz para o provider. */
export interface OutboundMessage {
  to: string;
  type: MessageType;
  text?: string;
  media?: { url: string; mimeType?: string; fileName?: string; caption?: string };
  quotedExternalId?: string;
  /** Somente Meta: template aprovado. Obrigatório fora da janela de 24h. */
  template?: { name: string; language: string; components?: unknown[]; category: BillingCategory };
  /**
   * Menu interativo (botões ou lista). Provider que não suporta (Evolution) converte para
   * texto numerado; a resposta do contato pode vir como id da opção ou como número/texto.
   */
  interactive?: InteractiveMenu;
}

export interface InteractiveMenu {
  /** até 3 opções → botões; mais → lista */
  options: { id: string; title: string; description?: string }[];
  /** texto do botão que abre a lista (Meta) */
  listButton?: string;
  header?: string;
  footer?: string;
}

export interface SendResult {
  externalId: string;
  status: MessageStatus;
  billingCategory: BillingCategory;
}

export interface StatusUpdate {
  provider: WhatsAppProviderKind;
  externalId: string;
  status: MessageStatus;
  timestamp: Date;
  error?: string;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  status: MessageStatus;
  text: string | null;
  mediaUrl: string | null;
  authorName: string | null;
  createdAt: string;
}

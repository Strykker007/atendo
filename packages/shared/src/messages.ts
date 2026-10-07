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
  /** estrutura de botões, lista, localização ou contato — o que não cabe em `text`/`media` */
  content?: MessageContent;
  /** o contato encaminhou esta mensagem (não foi ele quem escreveu) */
  forwarded?: boolean;
  /** quantas vezes já foi encaminhada; ≥ 5 o WhatsApp mostra "encaminhada com frequência" */
  forwardingScore?: number;
  quotedExternalId?: string;
  /** texto do que foi citado, quando a citada não é uma mensagem nossa (resposta a status) */
  quotedPreview?: string;
  /** a citação era um status/story (some em 24h, não é mensagem da conversa) */
  quotedFromStatus?: boolean;
  /**
   * Foto/vídeo do status citado. `thumbnail` (base64 JPEG) é a miniatura que vem no próprio
   * payload — reserva para quando a mídia inteira não puder mais ser baixada.
   */
  quotedMedia?: { kind: 'image' | 'video'; mimeType?: string; thumbnail?: string };
  /** id da opção escolhida num menu interativo (botão/lista), quando o provider informa */
  interactiveReplyId?: string;
  /** De onde o lead veio, quando o provider informa (anúncio Click-to-WhatsApp, link com contexto). */
  referral?: LeadReferral;
  timestamp: Date;
  raw: unknown;
}

/**
 * Reação (emoji) a uma mensagem. Não é mensagem: não entra no histórico, não conta no uso e
 * não aciona fluxo — só marca a mensagem reagida. `emoji` vazio = a reação foi retirada.
 */
export interface InboundReaction {
  provider: WhatsAppProviderKind;
  externalNumberId: string;
  /** id no provider da mensagem que recebeu a reação */
  targetExternalId: string;
  /** telefone do contato em E.164 */
  from: string;
  /** reação feita pelo celular do próprio cliente, não pelo contato */
  fromMe: boolean;
  emoji: string;
  timestamp: Date;
}

/**
 * O que o contato está fazendo agora na conversa. `paused` = parou (apagou, saiu do chat ou
 * enviou). É efêmero: não vai para o banco, só atravessa o socket.
 */
export type PresenceState = 'composing' | 'recording' | 'paused';

/** "Digitando…"/"gravando áudio…" do contato. Só a Evolution informa; a API da Meta não manda isto. */
export interface InboundPresence {
  provider: WhatsAppProviderKind;
  externalNumberId: string;
  /** telefone do contato em E.164 */
  from: string;
  state: PresenceState;
}

/**
 * Mensagem editada pelo contato (ou pelo celular do cliente). Não é mensagem nova: só troca o
 * texto da original. Hoje só a Evolution informa.
 */
export interface InboundEdit {
  provider: WhatsAppProviderKind;
  externalNumberId: string;
  /** id no provider da mensagem editada */
  targetExternalId: string;
  text: string;
}

/** Botão de mensagem interativa/template. `kind` diz o que ele faz no celular do contato. */
export interface ContentButton {
  id?: string;
  title: string;
  /** reply = resposta rápida; url = abre link; call = liga; copy = copia `value` (código, Pix) */
  kind: 'reply' | 'url' | 'call' | 'copy';
  /** url, telefone ou o texto que o botão copia */
  value?: string;
}

export interface ContentListRow {
  id?: string;
  title: string;
  description?: string;
}

export interface ContentContact {
  name: string;
  /** só dígitos (E.164 sem +) quando o vCard informa o waid; senão como veio */
  phones: string[];
}

/**
 * O que não cabe em `text` + `media`. Discriminado por `kind`; o corpo da mensagem continua em
 * `text` (assim busca, prévia, IA e fluxos seguem funcionando sem conhecer esta estrutura).
 */
export type MessageContent =
  | { kind: 'buttons'; header?: string; footer?: string; buttons: ContentButton[] }
  | { kind: 'list'; header?: string; footer?: string; buttonText?: string; sections: { title?: string; rows: ContentListRow[] }[] }
  | { kind: 'location'; lat: number; lng: number; name?: string; address?: string; live?: boolean }
  | { kind: 'contacts'; contacts: ContentContact[] };

/** Rótulo em português de cada tipo, para prévia/citação de mensagem sem texto. Nunca "unknown". */
export const MESSAGE_TYPE_LABEL: Record<MessageType, string> = {
  text: 'Mensagem',
  image: '📷 Foto',
  audio: '🎤 Áudio',
  video: '🎥 Vídeo',
  document: '📄 Documento',
  sticker: 'Figurinha',
  location: '📍 Localização',
  contact: '👤 Contato',
  template: 'Modelo',
  interactive: 'Mensagem interativa',
  unknown: 'Conteúdo não suportado',
};

const MEDIA_ICON: Partial<Record<MessageType, string>> = { image: '📷', video: '🎥', audio: '🎤', document: '📄' };

/** Prévia de uma linha (lista de conversas, citação): o texto, ou o rótulo do conteúdo. */
export function messagePreview(m: { type: MessageType | string; text?: string | null; content?: MessageContent | null; mediaName?: string | null; deletedAt?: string | Date | null }): string {
  if (m.deletedAt) return DELETED_MESSAGE_LABEL;
  const t = m.text?.trim();
  // mídia com legenda leva o ícone na frente, como no WhatsApp: "📷 Promoção" e não só "Promoção"
  if (t) return MEDIA_ICON[m.type as MessageType] ? `${MEDIA_ICON[m.type as MessageType]} ${t}` : t;
  const c = m.content;
  if (c?.kind === 'location') return `📍 ${c.name ?? c.address ?? (c.live ? 'Localização em tempo real' : 'Localização')}`;
  if (c?.kind === 'contacts') return `👤 ${c.contacts.map((x) => x.name).join(', ') || 'Contato'}`;
  if (m.type === 'document' && m.mediaName) return `📄 ${m.mediaName}`;
  return MESSAGE_TYPE_LABEL[m.type as MessageType] ?? 'Mensagem';
}

/** Evento `typing` do socket. */
export interface TypingEvent {
  conversationId: string;
  state: PresenceState;
}

/** Reação guardada na mensagem. No 1:1 do WhatsApp cada lado tem no máximo uma. */
export interface MessageReaction {
  emoji: string;
  fromMe: boolean;
  at: string;
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
  /** `voice`: áudio como mensagem de voz (PTT, padrão) ou `false` = arquivo de áudio */
  media?: { url: string; mimeType?: string; fileName?: string; caption?: string; voice?: boolean };
  quotedExternalId?: string;
  /**
   * Mostrar "digitando…" (ou "gravando…" no áudio) por este tempo antes de entregar. O adapter
   * que não suporta ignora. Usado no envio automático (docs/envio.md#humanização).
   */
  typingMs?: number;
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

/**
 * Mensagem citada, do jeito que a UI precisa para desenhar a bolha de citação.
 * `messageId` é nulo quando a citada não está no nosso banco (resposta a status, ou
 * mensagem anterior à adoção da ferramenta) — nesses casos só `preview` existe.
 */
export interface QuotedRef {
  /** id local da mensagem citada, quando ela está no nosso banco (permite scroll-to) */
  messageId: string | null;
  /** id no provider — sempre presente, é o que o webhook nos deu */
  externalId: string;
  direction: MessageDirection | null;
  type: MessageType | null;
  /** texto/caption resumido para a bolha de citação */
  preview: string | null;
  authorName: string | null;
  /** citação de status/story: some em 24h, não é mensagem da conversa */
  fromStatus: boolean;
  /** foto/vídeo do status citado (URL assinada); null quando não tem ou ainda não baixou */
  mediaUrl: string | null;
  /** com `mediaUrl` null, o tipo preenchido = a mídia ainda está sendo baixada */
  mediaType: 'image' | 'video' | null;
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
  /** a mensagem que esta responde; null quando não é resposta */
  quoted: QuotedRef | null;
  reactions: MessageReaction[] | null;
  /** botões, lista, localização ou contato; null para texto/mídia comuns */
  content: MessageContent | null;
  /** encaminhada (pelo contato, ou pelo atendente via "Encaminhar") */
  forwarded: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// Apagar mensagem (docs/apagar-mensagens.md)
// ---------------------------------------------------------------------------------------------

/**
 * Até quando o WhatsApp aceita "apagar para todos" (cerca de 2 dias depois do envio). Passou
 * disso, o provider recusa — a mensagem é apagada só no painel e o atendente é avisado.
 */
export const MESSAGE_REVOKE_WINDOW_MS = 48 * 60 * 60 * 1000;
/**
 * Quanto tempo quem enviou tem para apagar a PRÓPRIA mensagem sem `conversations.delete_message`.
 * Igual à janela do provider: depois dela nem o WhatsApp apaga, e o que sobra é esconder do
 * histórico — decisão de gerente.
 */
export const OWN_MESSAGE_DELETE_WINDOW_MS = MESSAGE_REVOKE_WINDOW_MS;
export const DELETED_MESSAGE_LABEL = '🚫 Mensagem apagada';
/**
 * Até quando o WhatsApp aceita editar uma mensagem enviada (15 min). Depois disso o provider
 * recusa — e editar só no painel mostraria ao atendente um texto que o contato nunca leu.
 */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Conteúdo original de uma mensagem apagada — só para `conversations.view_deleted`. */
export interface DeletedMessageOriginal {
  id: string;
  type: string;
  text: string | null;
  /** URL assinada e temporária (a chave no storage nunca sai da API) */
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  content: MessageContent | null;
  deletedAt: string;
  deletedByName: string | null;
  deletedForEveryone: boolean;
}

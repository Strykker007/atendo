import type { InboundEdit, InboundMessage, InboundPresence, InboundReaction, MessageTemplate, OutboundMessage, SendResult, StatusUpdate, NumberStatus } from '@atendo/shared';

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

/** Reação (emoji) que o atendente manda a uma mensagem da conversa. `emoji` vazio = retirar. */
export interface OutboundReaction {
  /** telefone do contato em E.164 */
  to: string;
  /** id no provider da mensagem reagida */
  targetExternalId: string;
  /** a reagida saiu de nós — a Evolution precisa disso para achar a mensagem */
  targetFromMe: boolean;
  emoji: string;
}

/** Mensagem nossa a apagar no celular do contato ("apagar para todos"). */
export interface OutboundRevoke {
  /** telefone do contato em E.164 */
  to: string;
  /** id no provider da mensagem enviada */
  externalId: string;
}

/** Novo texto para uma mensagem que NÓS enviamos. */
export interface OutboundEdit {
  /** telefone do contato em E.164 */
  to: string;
  /** id no provider da mensagem enviada */
  externalId: string;
  text: string;
}

export interface InboundContactName {
  externalNumberId: string;
  /** telefone do contato, só dígitos */
  phone: string;
  name: string;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  /** reações a mensagens — não são mensagens, só marcam a reagida */
  reactions: InboundReaction[];
  /** mensagem editada: troca o texto da original, não cria outra. Só a Evolution informa. */
  edits?: InboundEdit[];
  /** "digitando…"/"gravando áudio…" do contato — efêmero, só repassado ao painel. Meta não manda. */
  presences?: InboundPresence[];
  /**
   * Nome de contato vindo da sincronização de contatos (Evolution). Pode ser o da AGENDA do
   * celular ou só o pushName repetido — quem decide é `InboundService.applyContactName`.
   */
  contactNames?: InboundContactName[];
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
   * Foto/vídeo do status que o contato respondeu (`quotedFromStatus`). Opcional: só a Evolution
   * entrega resposta a status com a mídia citada.
   */
  fetchQuotedMedia?(ctx: NumberContext, message: InboundMessage): Promise<MediaPayload | null>;
  /**
   * Foto de perfil do contato. Opcional: a API oficial da Meta não expõe isto, então só a
   * Evolution implementa. Devolve `null` quando o contato não tem foto ou a esconde.
   */
  fetchProfilePicture?(ctx: NumberContext, phone: string): Promise<MediaPayload | null>;
  /** `phone`: telefone do contato, para o provider que precisa do chat além do id */
  markRead(ctx: NumberContext, externalMessageId: string, phone?: string): Promise<void>;
  /**
   * O telefone tem conta no WhatsApp? `null` = não deu para saber (não bloqueia). Opcional: a
   * Meta não oferece a consulta.
   */
  hasWhatsApp?(ctx: NumberContext, phone: string): Promise<boolean | null>;
  /** Reage a uma mensagem. Não é mensagem: não gera id, não entra no histórico. Lança se o provider recusar. */
  react(ctx: NumberContext, reaction: OutboundReaction): Promise<void>;
  /**
   * "Apagar para todos" de uma mensagem que NÓS enviamos. Opcional: a Cloud API da Meta não
   * tem essa operação — sem o método, a mensagem é apagada só no painel. Lança se o provider
   * recusar (prazo do WhatsApp, mensagem inexistente).
   */
  revoke?(ctx: NumberContext, target: OutboundRevoke): Promise<void>;
  /**
   * Editar o texto de uma mensagem que NÓS enviamos. Opcional: a Cloud API da Meta não tem essa
   * operação. Lança se o provider recusar (prazo de 15 min do WhatsApp, mensagem inexistente).
   */
  editMessage?(ctx: NumberContext, target: OutboundEdit): Promise<void>;
  /**
   * Pede ao WhatsApp para avisar quando o contato digitar/gravar (`presence.update`). Sem
   * isto o "digitando…" nunca chega. Opcional: a Meta não tem esse recurso.
   */
  subscribePresence?(ctx: NumberContext, phone: string): Promise<void>;
  /**
   * Presença para o contato (atendente escrevendo no painel). `composing` dura `ms` e volta a
   * `paused` sozinho; `paused` encerra na hora. Só no não oficial.
   */
  sendTyping?(ctx: NumberContext, phone: string, ms: number, state?: 'composing' | 'paused'): Promise<void>;
  /** online/offline da conta inteira. O WhatsApp não mostra "digitando" de quem está offline. */
  setOnline?(ctx: NumberContext, online: boolean): Promise<void>;
  /**
   * Nome que o provider guardou para o contato (agenda ou pushName, sem distinção). Usado só
   * para dar nome a contato que nasceu sem nenhum. Opcional: a Meta não tem agenda.
   */
  contactName?(ctx: NumberContext, phone: string): Promise<string | undefined>;
  /**
   * Templates aprovados da conta (HSM). Opcional: só a Meta tem — na Evolution qualquer texto
   * pode iniciar conversa.
   */
  listTemplates?(ctx: NumberContext): Promise<MessageTemplate[]>;
  /**
   * Agenda de contatos do aparelho (telefone só dígitos + nome). Opcional: só a Evolution tem —
   * a Meta não expõe a agenda do celular. Usado pela sincronização periódica de contatos.
   */
  listContacts?(ctx: NumberContext): Promise<{ phone: string; name: string }[]>;

  /** Valida assinatura/autenticidade do webhook. Lança se inválido. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): void;
  parseWebhook(body: unknown): ParsedWebhook;
}

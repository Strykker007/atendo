import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_OUTBOUND, type OutboundJob } from '../whatsapp/queues';
import { resumeNumber } from '../whatsapp/send-queue';
import { Prisma } from '@prisma/client';
import type { Contact, Conversation, Message, WhatsAppNumber } from '@prisma/client';
import { messagePreview } from '@atendo/shared';
import type { InboundEdit, InboundMessage, InboundPresence, InboundReaction, StatusUpdate, NumberStatus } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from '../billing/usage.service';
import { ConversationsGateway } from './conversations.gateway';
import { ConversationsService, MESSAGE_INCLUDE, inicioDaEspera } from './conversations.service';
import { decidirEntrada, voltandoDepoisDeEncerrado } from './reopen';
import { agendaParaRestaurar, escolherDaAgenda, nomeDaAgendaTroca, pushNameTrocaNome, trocaNaAgenda } from './contact-name';
import { planRemoval } from '../whatsapp/number-removal';

/**
 * Tudo que **entra** pelo provider: mensagem recebida, mensagem digitada no celular, confirmação
 * de entrega e mudança de conexão do número.
 *
 * Saiu de `ConversationsService` quando aquele arquivo passou de 800 linhas misturando entrada,
 * saída, atendimento e ficha. A divisão não é por tipo de arquivo: é pelo caminho que o dado
 * percorre. Aqui é o lado de fora falando com a gente, e é o único lugar que lida com payload
 * de provider — o resto do sistema só conhece conversa e mensagem.
 *
 * Depende de `ConversationsService` (e não o contrário): quem recebe precisa reabrir conversa e
 * apresentar mensagem; quem atende nunca precisa saber de webhook.
 */
/**
 * Resposta a status com foto/vídeo: o tipo já entra na criação, sem a URL — é o que a tela lê
 * como "carregando" até o worker guardar a mídia (`attachQuotedMedia`) ou desistir (`quotedMediaFailed`).
 */
const mimeDoStatusCitado = (msg: InboundMessage) =>
  msg.quotedFromStatus && msg.quotedMedia ? msg.quotedMedia.mimeType ?? (msg.quotedMedia.kind === 'video' ? 'video/mp4' : 'image/jpeg') : undefined;

@Injectable()
export class InboundService {
  private readonly log = new Logger(InboundService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly gateway: ConversationsGateway,
    private readonly conversations: ConversationsService,
    @InjectQueue(QUEUE_OUTBOUND) private readonly outbound: Queue<OutboundJob>,
  ) {}

  /** Download da mídia falhou de vez: registra para a UI não ficar em "carregando". */
  async mediaFailed(messageId: string, tenantId: string, reason: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { error: `Mídia indisponível: ${reason}`.slice(0, 200) }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(tenantId, this.conversations.present(m));
  }

  /** Chamado pelo worker depois de baixar a mídia recebida. */
  async attachMedia(messageId: string, tenantId: string, key: string, mimeType: string, fileName?: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { mediaUrl: key, mediaMime: mimeType, mediaName: fileName }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(tenantId, this.conversations.present(m));
  }

  /** Chamado pelo worker depois de guardar a foto/vídeo do status que o contato respondeu. */
  async attachQuotedMedia(messageId: string, tenantId: string, key: string, mimeType: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { quotedMediaUrl: key, quotedMediaMime: mimeType }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(tenantId, this.conversations.present(m));
  }

  /** Não deu para guardar nem a mídia nem a miniatura do status: tira o "carregando" da tela. */
  async quotedMediaFailed(messageId: string, tenantId: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { quotedMediaMime: null }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(tenantId, this.conversations.present(m));
  }

  // ---------- inbound (worker) ----------

  async ingestInbound(number: WhatsAppNumber, msg: InboundMessage): Promise<{ message: Message; conversation: Conversation; isNew: boolean; isNewContact: boolean; returningAfterClosed: boolean; hoursSinceLastMessage: number | null; fromMe?: boolean } | null> {
    // idempotência: o mesmo webhook pode chegar duas vezes. É também o que descarta o eco do
    // que o PAINEL enviou: aquela mensagem já está no banco com este externalId.
    const exists = await this.prisma.message.findUnique({ where: { externalId: msg.externalId } });
    if (exists) return null;

    // digitada no celular do cliente, não no painel: entra como enviada
    if (msg.fromMe) return this.ingestFromDevice(number, msg);

    let contact = await this.prisma.contact.findUnique({ where: { tenantId_phone: { tenantId: number.tenantId, phone: msg.from } } })
      ?? await this.createContact(number, msg.from, msg.contactName);
    if (msg.contactName) contact = await this.restaurarAgenda(number.tenantId, contact, msg.contactName);
    // o pushName só troca nome que também veio do WhatsApp (ou contato ainda sem nome): nome da
    // ficha ou da agenda não pode ser desfeito pela próxima mensagem do cliente
    if (pushNameTrocaNome(contact, msg.contactName)) {
      contact = await this.prisma.contact.update({ where: { id: contact.id }, data: { name: msg.contactName, nameSource: 'whatsapp' } });
    }

    // A conversa com esta pessoa neste número é UMA só, encerrada ou não (ver reopen.ts).
    // Encerrada, ela volta para a fila; o que começa de novo é o atendimento, não a conversa.
    let conversation = await this.prisma.conversation.findFirst({
      where: { numberId: number.id, contactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
    });
    const origin = this.originOf(msg.referral);
    // contexto para os fluxos padrão do cliente: é a primeira vez desta pessoa, ou ela
    // está voltando depois de um atendimento encerrado?
    const anterior = await this.prisma.conversation.findFirst({
      where: { tenantId: number.tenantId, contactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, status: true, lastMessageAt: true },
    });
    const isNewContact = !anterior;
    const decisao = decidirEntrada(conversation ? { id: conversation.id, status: conversation.status } : null);
    const returningAfterClosed = voltandoDepoisDeEncerrado(decisao, anterior?.status);
    const hoursSinceLastMessage = anterior?.lastMessageAt
      ? (msg.timestamp.getTime() - anterior.lastMessageAt.getTime()) / 3_600_000
      : null;
    if (decisao.acao === 'reabrir') {
      // atendimento novo na mesma conversa: volta para a fila, sem dono e sem o desfecho do
      // atendimento anterior — aquele já está congelado no histórico (conversation_events)
      conversation = await this.conversations.setStatusSystem(conversation!.id, 'waiting');
    }
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: 'waiting', origin, originData: msg.referral ? (msg.referral as unknown as Prisma.InputJsonValue) : undefined },
      });
      if (origin === 'ad') await this.autoTagAd(conversation.id, number.tenantId, msg.referral?.headline);
    } else if (msg.referral && conversation.origin === 'organic') {
      // referral pode chegar numa mensagem posterior (contato clicou no anúncio já com conversa aberta)
      conversation = await this.prisma.conversation.update({ where: { id: conversation.id }, data: { origin, originData: msg.referral as unknown as Prisma.InputJsonValue } });
      if (origin === 'ad') await this.autoTagAd(conversation.id, number.tenantId, msg.referral?.headline);
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        numberId: number.id,
        direction: 'in',
        type: msg.type,
        status: 'delivered',
        ...this.conteudo(msg),
        externalId: msg.externalId,
        quotedId: msg.quotedExternalId,
        quotedMessageId: await this.resolveQuoted(number.tenantId, msg.quotedExternalId),
        quotedPreview: msg.quotedPreview,
        quotedFromStatus: msg.quotedFromStatus ?? false,
        quotedMediaMime: mimeDoStatusCitado(msg),
        // guarda o payload do provider + o id da opção já traduzido: é assim que o motor de
        // fluxos e os lembretes sabem em qual botão o contato tocou, sem conhecer Meta/Evolution
        raw: { ...(msg.raw as object), ...(msg.interactiveReplyId ? { interactiveReplyId: msg.interactiveReplyId } : {}) } as Prisma.InputJsonValue,
        createdAt: msg.timestamp,
      },
      include: MESSAGE_INCLUDE,
    });

    conversation = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastInboundAt: msg.timestamp,
        lastMessageAt: msg.timestamp,
        awaitingSince: inicioDaEspera(conversation.awaitingSince, msg.timestamp),
        lastMessagePreview: this.previa(msg),
        unreadCount: { increment: 1 },
      },
    });

    await this.usage.record({
      tenantId: number.tenantId,
      numberId: number.id,
      messageId: message.id,
      provider: number.provider,
      direction: 'in',
      billingCategory: number.provider === 'meta' ? 'service' : 'unofficial',
      contactId: contact.id,
    });

    this.gateway.emitMessage(number.tenantId, this.conversations.present(message));
    this.gateway.emitConversation(number.tenantId, conversation);
    return { message, conversation, isNew: decisao.acao === 'criar', isNewContact, returningAfterClosed, hoursSinceLastMessage };
  }

  /**
   * Mensagem que o cliente mandou pelo CELULAR dele, não pelo painel.
   *
   * O WhatsApp entrega o mesmo evento das recebidas, só que marcado. Ignorá-las — como era
   * feito — deixava o painel com metade da conversa: aparecia o que o contato escreveu e
   * sumia o que o cliente respondeu do aparelho.
   *
   * Entra como mensagem enviada, sem autor (ninguém a escreveu no painel), e **sem acionar
   * automação**: disparar um fluxo por causa de algo que o próprio cliente escreveu seria o
   * robô respondendo ao dono do número.
   */
  private async ingestFromDevice(number: WhatsAppNumber, msg: InboundMessage) {
    // sem pushName: o desta mensagem é de quem a enviou (o dono do número), não do contato.
    // Nome só da agenda; senão chega na primeira mensagem que o contato mandar.
    const contact = await this.prisma.contact.findUnique({ where: { tenantId_phone: { tenantId: number.tenantId, phone: msg.from } } })
      ?? await this.createContact(number, msg.from);

    // mesma regra da entrada: uma conversa por pessoa neste número (ver reopen.ts)
    let conversation = await this.prisma.conversation.findFirst({
      where: { numberId: number.id, contactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
    });
    // conversa iniciada do celular: precisa existir no painel, senão a resposta do contato
    // abriria outra e o histórico nasceria partido
    const isNew = !conversation;
    // falar com alguém cujo atendimento estava encerrado começa outro atendimento — e quem
    // está atendendo é quem escreveu do celular, então vai direto para "em atendimento"
    if (conversation?.status === 'closed') conversation = await this.conversations.setStatusSystem(conversation.id, 'in_progress');
    conversation ??= await this.prisma.conversation.create({
      data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: 'in_progress' },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        numberId: number.id,
        direction: 'out',
        type: msg.type,
        status: 'sent',
        ...this.conteudo(msg),
        externalId: msg.externalId,
        quotedId: msg.quotedExternalId,
        quotedMessageId: await this.resolveQuoted(number.tenantId, msg.quotedExternalId),
        quotedPreview: msg.quotedPreview,
        quotedFromStatus: msg.quotedFromStatus ?? false,
        quotedMediaMime: mimeDoStatusCitado(msg),
        raw: msg.raw as Prisma.InputJsonValue,
        createdAt: msg.timestamp,
      },
      include: MESSAGE_INCLUDE,
    });

    // nada de lastInboundAt nem de não-lidas: quem falou foi o cliente, não o contato.
    // Mexer em lastInboundAt ainda reabriria a janela de 24h da Meta sem o contato ter escrito.
    conversation = await this.prisma.conversation.update({
      where: { id: conversation.id },
      // respondeu pelo celular também é resposta: a espera acabou
      data: { lastMessageAt: msg.timestamp, lastMessagePreview: this.previa(msg), awaitingSince: null },
    });

    await this.usage.record({
      tenantId: number.tenantId,
      numberId: number.id,
      messageId: message.id,
      provider: number.provider,
      direction: 'out',
      billingCategory: number.provider === 'meta' ? 'service' : 'unofficial',
      contactId: contact.id,
    });

    this.gateway.emitMessage(number.tenantId, this.conversations.present(message));
    this.gateway.emitConversation(number.tenantId, conversation);
    return { message, conversation, isNew, isNewContact: false, returningAfterClosed: false, hoursSinceLastMessage: null, fromMe: true };
  }

  /** Campos de conteúdo comuns às duas entradas (recebida e digitada no celular). */
  private conteudo(msg: InboundMessage) {
    return {
      text: msg.text,
      mediaMime: msg.media?.mimeType,
      mediaName: msg.media?.fileName,
      content: msg.content ? (msg.content as unknown as Prisma.InputJsonValue) : undefined,
      forwarded: msg.forwarded ?? false,
      forwardingScore: msg.forwardingScore,
    };
  }

  private previa(msg: InboundMessage) {
    return messagePreview({ type: msg.type, text: msg.text, content: msg.content, mediaName: msg.media?.fileName }).slice(0, 120);
  }

  /**
   * A citada pode não estar no banco (status/story, mensagem anterior à integração): aí fica só
   * o `quotedId`. Filtra pelo tenant porque `externalId` é único global, mas o dado não é de todos.
   */
  private async resolveQuoted(tenantId: string, quotedExternalId?: string): Promise<string | null> {
    if (!quotedExternalId) return null;
    const q = await this.prisma.message.findFirst({ where: { externalId: quotedExternalId, conversation: { tenantId } }, select: { id: true } });
    return q?.id ?? null;
  }

  private originOf(r?: InboundMessage['referral']) {
    if (!r) return 'organic' as const;
    if (r.sourceType === 'ad') return 'ad' as const;
    if (r.sourceType === 'post') return 'post' as const;
    return 'link' as const;
  }

  /**
   * Lead de anúncio ganha a tag "Anúncio" automaticamente (criada por tenant se não existir),
   * e uma tag com o título do anúncio quando houver — assim "leads por campanha" sai direto do filtro/relatório.
   */
  private async autoTagAd(conversationId: string, tenantId: string, headline?: string) {
    const names = ['Anúncio', ...(headline ? [`Anúncio: ${headline.slice(0, 32)}`] : [])];
    for (const name of names) {
      const tag = await this.prisma.tag.upsert({ where: { tenantId_name: { tenantId, name } }, create: { tenantId, name, color: '#f97316' }, update: {} });
      await this.prisma.conversationTag.upsert({ where: { conversationId_tagId: { conversationId, tagId: tag.id } }, create: { conversationId, tagId: tag.id }, update: {} });
    }
  }

  async applyStatus(st: StatusUpdate) {
    const m = await this.prisma.message.findUnique({ where: { externalId: st.externalId }, include: { conversation: { select: { tenantId: true } } } });
    if (!m) return;
    const order = ['pending', 'sent', 'delivered', 'read', 'failed'];
    if (order.indexOf(st.status) <= order.indexOf(m.status) && st.status !== 'failed') return; // não regride
    if (st.status === 'failed' && (m.status === 'delivered' || m.status === 'read')) return; // já chegou: erro tardio é ruído
    const updated = await this.prisma.message.update({ where: { id: m.id }, data: { status: st.status, error: st.error }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(m.conversation.tenantId, this.conversations.present(updated));
  }

  /**
   * Reação a uma mensagem. Antes ela entrava como mensagem nova ("[unknown]" citando a reagida);
   * agora só marca a reagida (regras em `ConversationsService.setReaction`). Reação a algo que
   * não está no banco é descartada.
   */
  async applyReaction(number: WhatsAppNumber, r: InboundReaction) {
    // filtra pelo tenant: externalId é único global, mas o dado não é de todos
    const m = await this.prisma.message.findFirst({ where: { externalId: r.targetExternalId, conversation: { tenantId: number.tenantId } }, select: { id: true } });
    if (!m) return;
    await this.conversations.setReaction(number.tenantId, m.id, { fromMe: r.fromMe, emoji: r.emoji, at: r.timestamp });
  }

  /**
   * Mensagem editada no celular: troca o texto da original. Edição de algo que não está no
   * banco é descartada — virar mensagem nova seria a bolha solta que o WhatsApp não mostra.
   */
  async applyEdit(number: WhatsAppNumber, e: InboundEdit) {
    // filtra pelo tenant: externalId é único global, mas o dado não é de todos
    const m = await this.prisma.message.findFirst({ where: { externalId: e.targetExternalId, conversation: { tenantId: number.tenantId } }, select: { id: true } });
    if (!m) return;
    const updated = await this.prisma.message.update({ where: { id: m.id }, data: { text: e.text, editedAt: new Date() }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(number.tenantId, this.conversations.present(updated));
  }

  /**
   * Contato novo: nasce com o nome da agenda do celular, se houver (`phonebook_entries`); senão
   * com o pushName. `upsert` porque duas mensagens da mesma pessoa podem chegar juntas.
   */
  private async createContact(number: WhatsAppNumber, phone: string, pushName?: string) {
    const agenda = escolherDaAgenda(
      await this.prisma.phonebookEntry.findMany({ where: { tenantId: number.tenantId, phone }, take: 10 }),
      number.id,
    );
    const inicial = agenda ? { name: agenda.name, nameSource: 'agenda' as const } : { name: pushName?.trim() || null, nameSource: 'whatsapp' as const };
    return this.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: number.tenantId, phone } },
      create: { tenantId: number.tenantId, phone, ...inicial },
      update: {},
    });
  }

  /**
   * Nome da sincronização de contatos (agenda do celular). Guarda na agenda do número
   * (`phonebook_entries`) e, se a pessoa já é contato, aplica a ela. Não cria contato: a agenda
   * tem milhares de pessoas e não pode aparecer no painel.
   *
   * O mesmo evento também chega com o pushName de cada mensagem: se o contato já mandou
   * mensagem com exatamente esse nome, não é agenda — nem guarda, nem aplica.
   */
  async applyContactName(number: WhatsAppNumber, c: { phone: string; name: string }) {
    const name = c.name.trim();
    const contact = await this.prisma.contact.findUnique({
      where: { tenantId_phone: { tenantId: number.tenantId, phone: c.phone } },
      select: { id: true, name: true, nameSource: true },
    });
    const jaVeioEmMensagem = !!contact && !!(await this.prisma.message.findFirst({
      where: { direction: 'in', conversation: { contactId: contact.id }, raw: { path: ['pushName'], equals: c.name } },
      select: { id: true },
    }));
    if (jaVeioEmMensagem) return;
    const chave = { numberId_phone: { numberId: number.id, phone: c.phone } };
    const atual = await this.prisma.phonebookEntry.findUnique({ where: chave, select: { name: true, previousName: true } });
    const registro = trocaNaAgenda(atual, name);
    if (registro) {
      await this.prisma.phonebookEntry.upsert({
        where: chave,
        create: { tenantId: number.tenantId, numberId: number.id, phone: c.phone, name: registro.name },
        update: registro,
      });
      // nome da agenda trocado fica no log: é o rastro para auditar se a troca era mesmo agenda
      if (atual) this.log.log(`agenda ${number.id} …${c.phone.slice(-4)}: "${atual.name}" → "${registro.name}"`);
    }
    if (!contact || !nomeDaAgendaTroca(contact, name, false)) return;
    await this.prisma.contact.update({ where: { id: contact.id }, data: { name, nameSource: 'agenda' } });
    await this.emitContactConversations(number.tenantId, contact.id);
  }

  /**
   * Mensagem chegou com um pushName igual ao nome atual da agenda que acabou de ser trocado: a
   * troca era o nome de perfil do WhatsApp (a pessoa mudou o nome dela sem mandar mensagem e a
   * Evolution avisou como se fosse agenda). Volta a agenda para o nome anterior e, se o contato
   * tinha recebido esse nome pela agenda, ele também. Ver `agendaParaRestaurar`.
   */
  private async restaurarAgenda(tenantId: string, contact: Contact, pushName: string): Promise<Contact> {
    const entradas = await this.prisma.phonebookEntry.findMany({
      where: { tenantId, phone: contact.phone, previousName: { not: null } },
      select: { id: true, numberId: true, name: true, previousName: true },
    });
    let paraContato: string | null = null;
    for (const e of entradas) {
      const nome = agendaParaRestaurar(e, pushName);
      if (!nome) continue;
      await this.prisma.phonebookEntry.update({ where: { id: e.id }, data: { name: nome, previousName: null } });
      this.log.warn(`agenda ${e.numberId} …${contact.phone.slice(-4)}: "${e.name}" era o nome de perfil do WhatsApp, não a agenda — volta para "${nome}"`);
      if (contact.nameSource === 'agenda' && contact.name === e.name) paraContato = nome;
    }
    if (!paraContato) return contact;
    return this.prisma.contact.update({ where: { id: contact.id }, data: { name: paraContato } });
  }

  /**
   * Sincronização completa da agenda do aparelho (job periódico, `contacts-sync.ts`). Passa
   * cada nome pela MESMA regra do webhook (`applyContactName`): guarda na agenda do número e
   * atualiza o nome de quem já é contato, sem criar contato novo. Só processa o que mudou desde a
   * última vez — a agenda tem milhares de linhas e quase nada muda entre uma rodada e outra.
   */
  async syncPhonebook(number: WhatsAppNumber, list: { phone: string; name: string }[]) {
    const atual = new Map((await this.prisma.phonebookEntry.findMany({ where: { numberId: number.id }, select: { phone: true, name: true } })).map((e) => [e.phone, e.name]));
    let changed = 0;
    for (const c of list) {
      if (atual.get(c.phone) === c.name.trim()) continue;
      await this.applyContactName(number, c);
      changed++;
    }
    return { total: list.length, changed };
  }

  /**
   * Contato que nasceu sem nome (conversa começada pelo celular do cliente): pergunta ao
   * provider. O que vier não dá para saber se é agenda ou pushName — entra como `whatsapp`.
   */
  async fillMissingName(number: WhatsAppNumber, contactId: string, lookup: (phone: string) => Promise<string | undefined>) {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true, name: true } });
    if (!contact || contact.name) return;
    const name = await lookup(contact.phone);
    if (!name) return;
    const r = await this.prisma.contact.updateMany({ where: { id: contactId, name: null }, data: { name, nameSource: 'whatsapp' } });
    if (r.count) await this.emitContactConversations(number.tenantId, contactId);
  }

  /** O nome aparece na lista e no cabeçalho: avisa as telas abertas. */
  private async emitContactConversations(tenantId: string, contactId: string) {
    const convs = await this.prisma.conversation.findMany({ where: { tenantId, contactId } });
    for (const c of convs) this.gateway.emitConversation(tenantId, c);
  }

  /**
   * "Digitando…" do contato. Só repassa ao painel: não cria contato nem conversa (alguém
   * digitando pela primeira vez ainda não é atendimento) e não grava nada.
   */
  async applyPresence(number: WhatsAppNumber, p: InboundPresence) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { tenantId: number.tenantId, numberId: number.id, contact: { phone: p.from } },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
    if (conversation) this.gateway.emitTyping(number.tenantId, { conversationId: conversation.id, state: p.state });
  }

  async numberConnectionChanged(number: WhatsAppNumber, c: { status: NumberStatus; qrCode?: string; phone?: string; transient?: boolean; loggedOut?: boolean }) {
    // Logo após parear, o WhatsApp reinicia o socket ('connecting'): é sincronização, não queda.
    // Um número já conectado não regride por causa disso.
    if (c.transient && number.status === 'connected') return;
    // 401 com o número CONECTADO = o WhatsApp (ou alguém no celular) removeu o aparelho. O
    // "Desconectar" do painel marca `disconnected` antes de chamar o provider, então não cai aqui.
    const removido = c.loggedOut && number.status === 'connected' ? planRemoval(number, new Date()) : null;
    if (removido) this.log.warn(`Número ${number.label} (${number.phone}) removido pelo WhatsApp (401 device_removed) — queda ${removido.waRemovedCount} em 24h, reconexão em pausa até ${removido.reconnectBlockedUntil.toISOString()}`);
    // o número que escaneou o QR pode não ser o digitado no cadastro: corrige com o real
    const phone = c.phone && c.phone !== number.phone ? c.phone : undefined;
    // Aquecimento desligado (a pedido): número novo não começa mais com teto de envios por dia.
    // O aquecimento POR HORA (number-warmup.ts) começa quando um QR novo é lido — reinício de
    // servidor ou oscilação de rede não reabre as 72h.
    const warmup: { warmupStartedAt?: Date; sessionStartedAt?: Date } = c.status === 'connected' && number.status === 'pending_qr' ? { sessionStartedAt: new Date() } : {};
    await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup, ...removido, ...(phone && { phone }) } }).catch(async (err) => {
      // conflito de unique (tenantId, phone): mantém o telefone antigo, só atualiza status
      if (String(err?.code) === 'P2002') await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup, ...removido } });
      else throw err;
    });
    this.gateway.emitNumber(number.tenantId, { id: number.id, status: c.status, qrCode: c.qrCode });
    // reconectou (QR lido): a fila do número, parada enquanto estava fora, retoma em ordem
    if (c.status === 'connected' && number.status !== 'connected') {
      const n = await resumeNumber(this.prisma, this.outbound, number.id);
      if (n) this.log.log(`Número ${number.label} reconectou: retomando ${n} conversa(s) na fila de envio`);
    }
  }

  // ---------- outbound (API) ----------
}

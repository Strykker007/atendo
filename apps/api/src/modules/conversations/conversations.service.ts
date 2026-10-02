import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { Conversation, ConversationOrigin, ConversationOutcome, ConversationStatus, WhatsAppNumber } from '@prisma/client';
import type { InboundMessage, StatusUpdate, NumberStatus, OutboundMessage } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from '../billing/usage.service';
import { StorageService } from '../../common/storage/storage.service';
import type { Message } from '@prisma/client';
import { ConversationsGateway } from './conversations.gateway';
import { QUEUE_OUTBOUND, type OutboundJob } from '../whatsapp/queues';
import type { Permission } from '@atendo/shared';
import { narrowTo } from '../auth/number-scope';

/**
 * Quem está pedindo. `permissions` vem do JwtAuthGuard; o papel fica só para o dono do
 * sistema, que dá suporte entrando como o cliente e não tem perfil neste tenant.
 */
type Viewer = { id: string; role: string; permissions?: readonly Permission[]; numberIds?: readonly string[] };
const may = (v: Viewer, p: Permission) => v.role === 'super_admin' || !!v.permissions?.includes(p);


const META_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ConversationsService {
  private readonly log = new Logger(ConversationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly gateway: ConversationsGateway,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_OUTBOUND) private readonly outbound: Queue<OutboundJob>,
  ) {}

  /**
   * Message.mediaUrl guarda a CHAVE no storage (privada). Antes de sair para o navegador
   * (HTTP ou socket) vira uma URL assinada e temporária.
   */
  present(m: Message): Message {
    return m.mediaUrl && !m.mediaUrl.startsWith('http') ? { ...m, mediaUrl: this.storage.signedUrl(m.mediaUrl) } : m;
  }

  /**
   * Mesma ideia para a foto do contato: no banco fica a chave, para o navegador vai uma URL
   * assinada. Sem isto o `<img>` receberia a chave crua e não carregaria nada.
   */
  presentContact<T extends { contact?: { avatarUrl?: string | null } | null }>(row: T): T {
    const key = row.contact?.avatarUrl;
    if (!key || key.startsWith('http')) return row;
    return { ...row, contact: { ...row.contact, avatarUrl: this.storage.signedUrl(key) } } as T;
  }

  // ---------- leitura ----------

  /**
   * Regra de posse:
   *  - `waiting`: sem dono, todo mundo vê.
   *  - `in_progress`: atendente comum vê SÓ as suas; admin vê todas (ou filtra por `assigneeId`).
   *  - `closed`: todos veem.
   * `viewer` decide isso; `assigneeId` explícito (admin) sobrescreve.
   */
  async list(
    tenantId: string,
    viewer: Viewer,
    q: { status?: ConversationStatus; numberId?: string; tagIds?: string[]; search?: string; origin?: ConversationOrigin; assigneeId?: string; cursor?: string; take?: number },
  ) {
    // quem vê os atendimentos da equipe é decidido por permissão, não pelo papel: é isso que
    // permite um "atendente líder" enxergar a equipe sem virar gerente
    const isAdmin = may(viewer, 'conversations.view_all');
    const scoped = narrowTo(viewer, q.numberId);
    const ownership: Prisma.ConversationWhereInput =
      q.assigneeId && isAdmin ? { assigneeId: q.assigneeId } : !isAdmin && q.status === 'in_progress' ? { assigneeId: viewer.id } : {};
    const where: Prisma.ConversationWhereInput = {
      tenantId,
      ...(q.status && { status: q.status }),
      ...(q.origin && { origin: q.origin }),
      ...ownership,
      // o número pedido é interseccionado com o escopo do usuário; `null` = pediu um número
      // que ele não opera, e aí a lista vem vazia em vez de ignorar o pedido
      ...(scoped === null ? { numberId: '-' } : scoped !== undefined ? { numberId: scoped } : {}),
      // tag da conversa OU tag do contato
      ...(q.tagIds?.length && { OR: [{ tags: { some: { tagId: { in: q.tagIds } } } }, { contact: { tags: { some: { tagId: { in: q.tagIds } } } } }] }),
      ...(q.search && {
        contact: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] },
      }),
    };
    const rows = await this.prisma.conversation.findMany({
      where,
      include: { contact: { include: { tags: { include: { tag: true } } } }, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, number: { select: { id: true, label: true } } },
      orderBy: { lastMessageAt: 'desc' },
      take: q.take ?? 50,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
    return rows.map((r) => this.presentContact(r));
  }

  /** Contadores dos três filtros principais (opcionalmente por número). */
  async counts(tenantId: string, viewer: Viewer, numberId?: string) {
    const scoped = narrowTo(viewer, numberId);
    const base = { tenantId, ...(scoped === null ? { numberId: '-' } : scoped !== undefined ? { numberId: scoped } : {}) };
    const [waiting, closed, mine, all] = await Promise.all([
      this.prisma.conversation.count({ where: { ...base, status: 'waiting' } }),
      this.prisma.conversation.count({ where: { ...base, status: 'closed' } }),
      this.prisma.conversation.count({ where: { ...base, status: 'in_progress', assigneeId: viewer.id } }),
      this.prisma.conversation.count({ where: { ...base, status: 'in_progress' } }),
    ]);
    // atendente comum conta só as suas em atendimento; admin conta todas
    return { waiting, in_progress: may(viewer, 'conversations.view_all') ? all : mine, closed, in_progress_mine: mine, in_progress_all: all };
  }

  /**
   * Assumir atendimento — ATÔMICO: só ganha quem encontra a conversa ainda sem dono
   * (ou já sua). Duas atendentes clicando juntas: a segunda recebe erro com o nome da primeira.
   */
  async claim(tenantId: string, id: string, user: { id: string; role: string }) {
    const r = await this.prisma.conversation.updateMany({
      where: { id, tenantId, status: { not: 'closed' }, OR: [{ assigneeId: null }, { assigneeId: user.id }] },
      data: { assigneeId: user.id, status: 'in_progress' },
    });
    if (r.count === 0) {
      const c = await this.prisma.conversation.findFirst({ where: { id, tenantId }, include: { assignee: { select: { name: true } } } });
      if (!c) throw new NotFoundException('Conversa não encontrada');
      if (c.status === 'closed') throw new BadRequestException('Conversa encerrada. Reabra para assumir.');
      throw new ConflictException(`${c.assignee?.name ?? 'Outro atendente'} já assumiu este atendimento.`);
    }
    const conv = await this.prisma.conversation.findUniqueOrThrow({ where: { id } });
    this.gateway.emitConversation(tenantId, conv);
    return conv;
  }

  /** Transferir para outro atendente (admin, ou o próprio dono). */
  async transfer(tenantId: string, id: string, toUserId: string, by: Viewer) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (!may(by, 'conversations.transfer_any') && conv.assigneeId !== by.id) throw new ForbiddenException('Só quem está atendendo (ou quem tem permissão) pode transferir.');
    const target = await this.prisma.user.findFirst({ where: { id: toUserId, tenantId, isActive: true } });
    if (!target) throw new NotFoundException('Atendente não encontrado');
    const updated = await this.prisma.conversation.update({ where: { id }, data: { assigneeId: target.id, status: conv.status === 'closed' ? 'closed' : 'in_progress' } });
    this.gateway.emitConversation(tenantId, updated);
    return updated;
  }

  /** Devolver para a fila (sem dono, volta a Aguardando). */
  async release(tenantId: string, id: string, by: Viewer) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (!may(by, 'conversations.transfer_any') && conv.assigneeId !== by.id) throw new ForbiddenException('Só quem está atendendo (ou quem tem permissão) pode devolver.');
    const updated = await this.prisma.conversation.update({ where: { id }, data: { assigneeId: null, status: 'waiting' } });
    this.gateway.emitConversation(tenantId, updated);
    return updated;
  }

  async one(tenantId: string, id: string) {
    const row = await this.prisma.conversation.findFirstOrThrow({
      where: { id, tenantId },
      include: { contact: { include: { tags: { include: { tag: true } } } }, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, number: { select: { id: true, label: true, provider: true, status: true } } },
    });
    return this.presentContact(row);
  }

  async messages(tenantId: string, conversationId: string, cursor?: string, take = 50) {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, conversation: { tenantId } },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: { author: { select: { name: true } } },
    });
    return rows.map((m) => this.present(m));
  }

  /** Download da mídia falhou de vez: registra para a UI não ficar em "carregando". */
  async mediaFailed(messageId: string, tenantId: string, reason: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { error: `Mídia indisponível: ${reason}`.slice(0, 200) } });
    this.gateway.emitMessage(tenantId, this.present(m));
  }

  /** Chamado pelo worker depois de baixar a mídia recebida. */
  async attachMedia(messageId: string, tenantId: string, key: string, mimeType: string, fileName?: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { mediaUrl: key, mediaMime: mimeType, mediaName: fileName } });
    this.gateway.emitMessage(tenantId, this.present(m));
  }

  // ---------- inbound (worker) ----------

  async ingestInbound(number: WhatsAppNumber, msg: InboundMessage): Promise<{ message: Message; conversation: Conversation; isNew: boolean; isNewContact: boolean; returningAfterClosed: boolean; hoursSinceLastMessage: number | null; fromMe?: boolean } | null> {
    // idempotência: o mesmo webhook pode chegar duas vezes. É também o que descarta o eco do
    // que o PAINEL enviou: aquela mensagem já está no banco com este externalId.
    const exists = await this.prisma.message.findUnique({ where: { externalId: msg.externalId } });
    if (exists) return null;

    // digitada no celular do cliente, não no painel: entra como enviada
    if (msg.fromMe) return this.ingestFromDevice(number, msg);

    const contact = await this.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: number.tenantId, phone: msg.from } },
      create: { tenantId: number.tenantId, phone: msg.from, name: msg.contactName },
      update: msg.contactName ? { name: msg.contactName } : {},
    });

    // conversa aberta (não encerrada) com este contato neste número, senão cria uma nova em "aguardando"
    let conversation = await this.prisma.conversation.findFirst({
      where: { numberId: number.id, contactId: contact.id, status: { not: 'closed' } },
    });
    const origin = this.originOf(msg.referral);
    const isNew = !conversation;
    // contexto para os fluxos padrão do cliente: é a primeira vez desta pessoa, ou ela
    // está voltando depois de um atendimento encerrado?
    const anterior = await this.prisma.conversation.findFirst({
      where: { tenantId: number.tenantId, contactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, status: true, lastMessageAt: true },
    });
    const isNewContact = !anterior;
    const returningAfterClosed = isNew && !!anterior && anterior.status === 'closed';
    const hoursSinceLastMessage = anterior?.lastMessageAt
      ? (msg.timestamp.getTime() - anterior.lastMessageAt.getTime()) / 3_600_000
      : null;
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
        direction: 'in',
        type: msg.type,
        status: 'delivered',
        text: msg.text,
        mediaMime: msg.media?.mimeType,
        mediaName: msg.media?.fileName,
        externalId: msg.externalId,
        quotedId: msg.quotedExternalId,
        // guarda o payload do provider + o id da opção já traduzido: é assim que o motor de
        // fluxos e os lembretes sabem em qual botão o contato tocou, sem conhecer Meta/Evolution
        raw: { ...(msg.raw as object), ...(msg.interactiveReplyId ? { interactiveReplyId: msg.interactiveReplyId } : {}) } as Prisma.InputJsonValue,
        createdAt: msg.timestamp,
      },
    });

    conversation = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastInboundAt: msg.timestamp,
        lastMessageAt: msg.timestamp,
        lastMessagePreview: (msg.text ?? `[${msg.type}]`).slice(0, 120),
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

    this.gateway.emitMessage(number.tenantId, message);
    this.gateway.emitConversation(number.tenantId, conversation);
    return { message, conversation, isNew, isNewContact, returningAfterClosed, hoursSinceLastMessage };
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
    const contact = await this.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: number.tenantId, phone: msg.from } },
      create: { tenantId: number.tenantId, phone: msg.from, name: msg.contactName },
      update: {},
    });

    let conversation = await this.prisma.conversation.findFirst({
      where: { numberId: number.id, contactId: contact.id, status: { not: 'closed' } },
    });
    // conversa iniciada do celular: precisa existir no painel, senão a resposta do contato
    // abriria outra e o histórico nasceria partido
    const isNew = !conversation;
    conversation ??= await this.prisma.conversation.create({
      data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: 'waiting' },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'out',
        type: msg.type,
        status: 'sent',
        text: msg.text,
        mediaMime: msg.media?.mimeType,
        mediaName: msg.media?.fileName,
        externalId: msg.externalId,
        quotedId: msg.quotedExternalId,
        raw: msg.raw as Prisma.InputJsonValue,
        createdAt: msg.timestamp,
      },
    });

    // nada de lastInboundAt nem de não-lidas: quem falou foi o cliente, não o contato.
    // Mexer em lastInboundAt ainda reabriria a janela de 24h da Meta sem o contato ter escrito.
    conversation = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: msg.timestamp, lastMessagePreview: (msg.text ?? `[${msg.type}]`).slice(0, 120) },
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

    this.gateway.emitMessage(number.tenantId, message);
    this.gateway.emitConversation(number.tenantId, conversation);
    return { message, conversation, isNew, isNewContact: false, returningAfterClosed: false, hoursSinceLastMessage: null, fromMe: true };
  }

  /**
   * Envio pelo sistema (fluxos de automação): sem autor humano, não assume a conversa,
   * respeita quota e janela de 24h, passa pela mesma fila.
   */
  async sendAsSystem(conversationId: string, text?: string, media?: { key: string; type: 'image' | 'document' | 'audio' | 'video'; name?: string }, interactive?: import('@atendo/shared').InteractiveMenu) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { number: true } });
    if (!conv || conv.status === 'closed') throw new BadRequestException('Conversa indisponível');
    if (conv.number.status !== 'connected') throw new BadRequestException('Número desconectado');
    if (conv.number.provider === 'meta') {
      const inWindow = conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < META_WINDOW_MS;
      if (!inWindow) throw new BadRequestException('Fora da janela de 24h da Meta');
    }
    const quota = await this.usage.canSend(conv.tenantId, 'messages');
    if (!quota.ok) throw new ForbiddenException(quota.reason);
    // no histórico do painel a mensagem interativa aparece como texto + opções numeradas
    const shown = interactive?.options.length ? `${text ?? ''}\n\n${interactive.options.map((o, i) => `${i + 1} - ${o.title}`).join('\n')}` : text;
    const message = await this.prisma.message.create({
      data: { conversationId, direction: 'out', type: media ? media.type : 'text', status: 'pending', text: shown, mediaUrl: media?.key, mediaName: media?.name, raw: interactive ? ({ interactive, body: text } as unknown as Prisma.InputJsonValue) : undefined },
    });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastMessagePreview: (shown ?? `[${media?.type}]`).slice(0, 120) } });
    await this.outbound.add('send', { messageId: message.id });
    this.gateway.emitMessage(conv.tenantId, this.present(message));
    return message;
  }

  /** Número do tenant usado para mensagens do sistema (lembretes): o preferido nas configurações ou o primeiro conectado. */
  private async systemNumber(tenantId: string, preferredId?: string | null) {
    const n = (preferredId && (await this.prisma.whatsAppNumber.findFirst({ where: { id: preferredId, tenantId, status: 'connected', isActive: true } })))
      || (await this.prisma.whatsAppNumber.findFirst({ where: { tenantId, status: 'connected', isActive: true }, orderBy: { createdAt: 'asc' } }));
    if (!n) throw new BadRequestException('Nenhum número conectado para enviar');
    return n;
  }

  /** Manda uma mensagem do sistema para um contato: reaproveita a conversa aberta ou cria uma. */
  async sendToContact(tenantId: string, contactId: string, text: string, opts?: { preferredNumberId?: string | null; interactive?: import('@atendo/shared').InteractiveMenu }) {
    const contact = await this.prisma.contact.findFirstOrThrow({ where: { id: contactId, tenantId } });
    let conv = await this.prisma.conversation.findFirst({ where: { contactId, status: { not: 'closed' } }, orderBy: { lastMessageAt: 'desc' } });
    if (!conv) {
      const number = await this.systemNumber(tenantId, opts?.preferredNumberId);
      conv = await this.prisma.conversation.create({ data: { tenantId, numberId: number.id, contactId: contact.id, status: 'closed', closedAt: new Date() } });
    }
    return this.sendAsSystem(conv.id, text, undefined, opts?.interactive);
  }

  /** Manda para um telefone qualquer (ex.: WhatsApp do barbeiro). Cria contato/conversa se preciso. */
  async sendToPhone(tenantId: string, phone: string, text: string, opts?: { closeAfter?: boolean; contactName?: string; preferredNumberId?: string | null }) {
    const clean = phone.replace(/\D/g, '');
    const contact = await this.prisma.contact.upsert({ where: { tenantId_phone: { tenantId, phone: clean } }, create: { tenantId, phone: clean, name: opts?.contactName }, update: {} });
    const number = await this.systemNumber(tenantId, opts?.preferredNumberId);
    let conv = await this.prisma.conversation.findFirst({ where: { contactId: contact.id, numberId: number.id }, orderBy: { lastMessageAt: 'desc' } });
    if (!conv) conv = await this.prisma.conversation.create({ data: { tenantId, numberId: number.id, contactId: contact.id, status: 'closed', closedAt: new Date() } });
    // conversa fechada: sendAsSystem exige aberta → abre, envia, fecha de novo (não polui a fila)
    if (conv.status === 'closed') await this.prisma.conversation.update({ where: { id: conv.id }, data: { status: 'in_progress' } });
    const m = await this.sendAsSystem(conv.id, text);
    if (opts?.closeAfter !== false) await this.prisma.conversation.update({ where: { id: conv.id }, data: { status: 'closed', closedAt: new Date() } });
    return m;
  }

  async setStatusSystem(conversationId: string, status: ConversationStatus) {
    const conv = await this.prisma.conversation.update({ where: { id: conversationId }, data: { status, closedAt: status === 'closed' ? new Date() : null, ...(status === 'waiting' && { assigneeId: null }) } });
    this.gateway.emitConversation(conv.tenantId, conv);
    return conv;
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
    const updated = await this.prisma.message.update({ where: { id: m.id }, data: { status: st.status, error: st.error } });
    this.gateway.emitMessage(m.conversation.tenantId, this.present(updated));
  }

  async numberConnectionChanged(number: WhatsAppNumber, c: { status: NumberStatus; qrCode?: string; phone?: string; transient?: boolean; loggedOut?: boolean }) {
    // Logo após parear, o WhatsApp reinicia o socket ('connecting'): é sincronização, não queda.
    // Um número já conectado não regride por causa disso.
    if (c.transient && number.status === 'connected') return;
    if (c.loggedOut) this.log.warn(`Número ${number.label} (${number.phone}) foi desconectado pelo celular (dispositivo removido)`);
    // o número que escaneou o QR pode não ser o digitado no cadastro: corrige com o real
    const phone = c.phone && c.phone !== number.phone ? c.phone : undefined;
    // Aquecimento só para número REALMENTE novo: se já enviou alguma vez, é uma linha
    // estabelecida e limitá-la a 20 envios/dia quebraria o atendimento do cliente.
    let warmup: { warmupStartedAt?: Date } = {};
    if (c.status === 'connected' && !number.warmupStartedAt) {
      const jaEnviou = await this.prisma.messageUsage.findFirst({ where: { numberId: number.id, direction: 'out' }, select: { id: true } });
      if (!jaEnviou) {
        warmup = { warmupStartedAt: new Date() };
        this.log.log(`Número ${number.label} conectou pela primeira vez: aquecimento iniciado`);
      }
    }
    await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup, ...(phone && { phone }) } }).catch(async (err) => {
      // conflito de unique (tenantId, phone): mantém o telefone antigo, só atualiza status
      if (String(err?.code) === 'P2002') await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup } });
      else throw err;
    });
    this.gateway.emitNumber(number.tenantId, { id: number.id, status: c.status, qrCode: c.qrCode });
  }

  // ---------- outbound (API) ----------

  async send(tenantId: string, author: Viewer, conversationId: string, input: Omit<OutboundMessage, 'to'> & { mediaKey?: string }) {
    const authorId = author.id;
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { number: true },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.status === 'closed') throw new BadRequestException('Conversa encerrada. Reabra para responder.');
    if (conv.number.status !== 'connected') {
      throw new BadRequestException(`O número "${conv.number.label}" está desconectado. Conecte-o em Números para responder.`);
    }

    // Regra da Meta: fora da janela de 24h só sai template aprovado
    if (conv.number.provider === 'meta' && !input.template) {
      const inWindow = conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < META_WINDOW_MS;
      if (!inWindow) throw new BadRequestException('Janela de 24h da Meta expirou. Envie um template aprovado.');
    }

    const quota = await this.usage.canSend(tenantId, input.template ? 'templates' : 'messages');
    if (!quota.ok) throw new ForbiddenException(quota.reason);

    // Responder = assumir. Atômico: se outra atendente assumiu no meio tempo, falha com o nome dela.
    // Conversa de OUTRA pessoa: ninguém (nem admin) responde ao cliente por ela — admin/gerente usa
    // nota interna (cadeado). Para atender, transfere para si.
    if (conv.assigneeId !== authorId) {
      const r = await this.prisma.conversation.updateMany({ where: { id: conv.id, OR: [{ assigneeId: null }, { assigneeId: authorId }] }, data: { assigneeId: authorId, status: 'in_progress' } });
      if (r.count === 0) {
        const owner = await this.prisma.conversation.findUnique({ where: { id: conv.id }, include: { assignee: { select: { name: true } } } });
        throw new ConflictException(`${owner?.assignee?.name ?? 'Outro atendente'} está atendendo. Use uma nota interna ou transfira para você.`);
      }
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'out',
        type: input.template ? 'template' : input.type,
        status: 'pending',
        text: input.text,
        mediaUrl: input.mediaKey ?? input.media?.url,
        mediaMime: input.media?.mimeType,
        mediaName: input.media?.fileName,
        quotedId: input.quotedExternalId,
        authorId,
        raw: input.template ? ({ template: input.template } as Prisma.InputJsonValue) : undefined,
      },
    });

    const updatedConv = await this.prisma.conversation.update({
      where: { id: conv.id },
      data: {
        status: conv.status === 'waiting' ? 'in_progress' : conv.status,
        lastMessageAt: new Date(),
        lastMessagePreview: (input.text ?? `[${input.type}]`).slice(0, 120),
        unreadCount: 0,
      },
    });

    await this.outbound.add('send', { messageId: message.id });
    this.gateway.emitMessage(tenantId, this.present(message));
    this.gateway.emitConversation(tenantId, updatedConv);
    return this.present(message);
  }

  /** Reenvia uma mensagem que falhou: volta para pending e enfileira de novo. */
  async resend(tenantId: string, messageId: string) {
    const m = await this.prisma.message.findFirst({ where: { id: messageId, direction: 'out', status: 'failed', conversation: { tenantId } }, include: { conversation: { include: { number: true } } } });
    if (!m) throw new NotFoundException('Mensagem não encontrada ou não está com falha');
    if (m.conversation.number.status !== 'connected') throw new BadRequestException(`O número "${m.conversation.number.label}" está desconectado.`);
    const updated = await this.prisma.message.update({ where: { id: m.id }, data: { status: 'pending', error: null } });
    await this.outbound.add('send', { messageId: m.id });
    this.gateway.emitMessage(tenantId, this.present(updated));
    return this.present(updated);
  }

  /**
   * Nota interna ("cadeado"): admin/gerente orienta o atendente dentro da conversa.
   * Fica no histórico com destaque, só a equipe vê, nunca vai ao WhatsApp, não conta no uso.
   */
  async note(tenantId: string, author: Viewer, conversationId: string, text: string) {
    if (!may(author, 'conversations.internal_note')) throw new ForbiddenException('Seu perfil de acesso não permite escrever notas internas.');
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const message = await this.prisma.message.create({
      data: { conversationId: conv.id, direction: 'out', type: 'text', status: 'delivered', text, authorId: author.id, internal: true },
      include: { author: { select: { name: true } } },
    });
    this.gateway.emitMessage(tenantId, this.present(message));
    return this.present(message);
  }

  /** Atualiza a ficha do contato. Campo vazio limpa — o atendente apaga o que não vale mais. */
  async updateContact(tenantId: string, contactId: string, data: { name?: string; email?: string; address?: string; note1?: string; note2?: string }) {
    const limpo = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v?.trim()]),
    );
    // contato inexistente (ou de outro cliente) é 404, não erro interno
    const contact = await this.prisma.contact.update({ where: { id: contactId, tenantId }, data: limpo }).catch((err) => {
      if (String((err as { code?: string })?.code) === 'P2025') throw new NotFoundException('Contato não encontrado');
      throw err;
    });
    // a ficha aparece no cabeçalho do chat: avisa quem está com a conversa aberta
    const convs = await this.prisma.conversation.findMany({ where: { contactId, tenantId }, select: { id: true } });
    for (const c of convs) {
      const full = await this.prisma.conversation.findUniqueOrThrow({ where: { id: c.id } });
      this.gateway.emitConversation(tenantId, full);
    }
    return contact;
  }

  async setStatus(
    tenantId: string,
    id: string,
    status: ConversationStatus,
    userId: string,
    outcome?: { outcome: ConversationOutcome; value?: number; reason?: string },
  ) {
    // o desfecho só faz sentido ao encerrar; reabrir limpa, porque o atendimento continua
    const desfecho =
      status !== 'closed'
        ? { outcome: 'none' as const, outcomeValue: null, outcomeReason: null, outcomeAt: null, outcomeById: null }
        : outcome && outcome.outcome !== 'none'
          ? {
              outcome: outcome.outcome,
              outcomeValue: outcome.outcome === 'won' && outcome.value != null ? new Prisma.Decimal(outcome.value) : null,
              outcomeReason: outcome.outcome === 'lost' ? (outcome.reason?.trim() || null) : null,
              outcomeAt: new Date(),
              outcomeById: userId,
            }
          : {};

    const conv = await this.prisma.conversation.update({
      where: { id, tenantId },
      data: {
        status,
        closedAt: status === 'closed' ? new Date() : null,
        // reabrir em "in_progress" = quem reabriu assume; reabrir em "waiting" = volta para a fila
        ...(status === 'in_progress' && { assigneeId: userId }),
        ...(status === 'waiting' && { assigneeId: null }),
        ...desfecho,
      },
    });
    this.gateway.emitConversation(tenantId, conv);
    return conv;
  }

  async setTags(tenantId: string, id: string, tagIds: string[]) {
    await this.prisma.conversation.findFirstOrThrow({ where: { id, tenantId } });
    await this.prisma.$transaction([
      this.prisma.conversationTag.deleteMany({ where: { conversationId: id } }),
      this.prisma.conversationTag.createMany({ data: tagIds.map((tagId) => ({ conversationId: id, tagId })) }),
    ]);
    return this.prisma.conversation.findUnique({ where: { id }, include: { tags: { include: { tag: true } } } });
  }

  /** Tags da pessoa (valem para todas as conversas dela). */
  async setContactTags(tenantId: string, contactId: string, tagIds: string[]) {
    await this.prisma.contact.findFirstOrThrow({ where: { id: contactId, tenantId } });
    await this.prisma.$transaction([
      this.prisma.contactTag.deleteMany({ where: { contactId } }),
      this.prisma.contactTag.createMany({ data: tagIds.map((tagId) => ({ contactId, tagId })) }),
    ]);
    const convs = await this.prisma.conversation.findMany({ where: { contactId } });
    for (const c of convs) this.gateway.emitConversation(tenantId, c);
    return this.prisma.contact.findUnique({ where: { id: contactId }, include: { tags: { include: { tag: true } } } });
  }

  async markRead(tenantId: string, id: string) {
    return this.prisma.conversation.update({ where: { id, tenantId }, data: { unreadCount: 0 } });
  }
}

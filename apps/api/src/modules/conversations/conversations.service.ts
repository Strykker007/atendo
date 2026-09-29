import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Conversation, ConversationOrigin, ConversationStatus, Prisma, WhatsAppNumber } from '@prisma/client';
import type { InboundMessage, StatusUpdate, NumberStatus, OutboundMessage } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from '../billing/usage.service';
import { StorageService } from '../../common/storage/storage.service';
import type { Message } from '@prisma/client';
import { ConversationsGateway } from './conversations.gateway';
import { QUEUE_OUTBOUND, type OutboundJob } from '../whatsapp/queues';

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

  // ---------- leitura ----------

  /**
   * Regra de posse:
   *  - `waiting`: sem dono, todo mundo vê.
   *  - `in_progress`: atendente comum vê SÓ as suas; admin vê todas (ou filtra por `assigneeId`).
   *  - `closed`: todos veem.
   * `viewer` decide isso; `assigneeId` explícito (admin) sobrescreve.
   */
  list(
    tenantId: string,
    viewer: { id: string; role: string },
    q: { status?: ConversationStatus; numberId?: string; tagIds?: string[]; search?: string; origin?: ConversationOrigin; assigneeId?: string; cursor?: string; take?: number },
  ) {
    const isAdmin = viewer.role !== 'agent';
    const ownership: Prisma.ConversationWhereInput =
      q.assigneeId && isAdmin ? { assigneeId: q.assigneeId } : !isAdmin && q.status === 'in_progress' ? { assigneeId: viewer.id } : {};
    const where: Prisma.ConversationWhereInput = {
      tenantId,
      ...(q.status && { status: q.status }),
      ...(q.origin && { origin: q.origin }),
      ...ownership,
      ...(q.numberId && { numberId: q.numberId }),
      // tag da conversa OU tag do contato
      ...(q.tagIds?.length && { OR: [{ tags: { some: { tagId: { in: q.tagIds } } } }, { contact: { tags: { some: { tagId: { in: q.tagIds } } } } }] }),
      ...(q.search && {
        contact: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] },
      }),
    };
    return this.prisma.conversation.findMany({
      where,
      include: { contact: { include: { tags: { include: { tag: true } } } }, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, number: { select: { id: true, label: true } } },
      orderBy: { lastMessageAt: 'desc' },
      take: q.take ?? 50,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
  }

  /** Contadores dos três filtros principais (opcionalmente por número). */
  async counts(tenantId: string, viewer: { id: string; role: string }, numberId?: string) {
    const base = { tenantId, ...(numberId && { numberId }) };
    const [waiting, closed, mine, all] = await Promise.all([
      this.prisma.conversation.count({ where: { ...base, status: 'waiting' } }),
      this.prisma.conversation.count({ where: { ...base, status: 'closed' } }),
      this.prisma.conversation.count({ where: { ...base, status: 'in_progress', assigneeId: viewer.id } }),
      this.prisma.conversation.count({ where: { ...base, status: 'in_progress' } }),
    ]);
    // atendente comum conta só as suas em atendimento; admin conta todas
    return { waiting, in_progress: viewer.role === 'agent' ? mine : all, closed, in_progress_mine: mine, in_progress_all: all };
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
  async transfer(tenantId: string, id: string, toUserId: string, by: { id: string; role: string }) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (by.role === 'agent' && conv.assigneeId !== by.id) throw new ForbiddenException('Só quem está atendendo (ou um admin) pode transferir.');
    const target = await this.prisma.user.findFirst({ where: { id: toUserId, tenantId, isActive: true } });
    if (!target) throw new NotFoundException('Atendente não encontrado');
    const updated = await this.prisma.conversation.update({ where: { id }, data: { assigneeId: target.id, status: conv.status === 'closed' ? 'closed' : 'in_progress' } });
    this.gateway.emitConversation(tenantId, updated);
    return updated;
  }

  /** Devolver para a fila (sem dono, volta a Aguardando). */
  async release(tenantId: string, id: string, by: { id: string; role: string }) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (by.role === 'agent' && conv.assigneeId !== by.id) throw new ForbiddenException('Só quem está atendendo (ou um admin) pode devolver.');
    const updated = await this.prisma.conversation.update({ where: { id }, data: { assigneeId: null, status: 'waiting' } });
    this.gateway.emitConversation(tenantId, updated);
    return updated;
  }

  one(tenantId: string, id: string) {
    return this.prisma.conversation.findFirstOrThrow({
      where: { id, tenantId },
      include: { contact: { include: { tags: { include: { tag: true } } } }, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, number: { select: { id: true, label: true, provider: true, status: true } } },
    });
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

  async ingestInbound(number: WhatsAppNumber, msg: InboundMessage): Promise<{ message: Message; conversation: Conversation; isNew: boolean; isNewContact: boolean; returningAfterClosed: boolean; hoursSinceLastMessage: number | null } | null> {
    // idempotência: o mesmo webhook pode chegar duas vezes
    const exists = await this.prisma.message.findUnique({ where: { externalId: msg.externalId } });
    if (exists) return null;

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
    });

    this.gateway.emitMessage(number.tenantId, message);
    this.gateway.emitConversation(number.tenantId, conversation);
    return { message, conversation, isNew, isNewContact, returningAfterClosed, hoursSinceLastMessage };
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
    // primeira conexão: começa o aquecimento — número novo com volume alto é banido rápido
    const warmup = c.status === 'connected' && !number.warmupStartedAt ? { warmupStartedAt: new Date() } : {};
    if (warmup.warmupStartedAt) this.log.log(`Número ${number.label} conectou pela primeira vez: aquecimento iniciado`);
    await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup, ...(phone && { phone }) } }).catch(async (err) => {
      // conflito de unique (tenantId, phone): mantém o telefone antigo, só atualiza status
      if (String(err?.code) === 'P2002') await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup } });
      else throw err;
    });
    this.gateway.emitNumber(number.tenantId, { id: number.id, status: c.status, qrCode: c.qrCode });
  }

  // ---------- outbound (API) ----------

  async send(tenantId: string, author: { id: string; role: string }, conversationId: string, input: Omit<OutboundMessage, 'to'> & { mediaKey?: string }) {
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
  async note(tenantId: string, author: { id: string; role: string }, conversationId: string, text: string) {
    if (author.role === 'agent') throw new ForbiddenException('Só gerentes e administradores enviam notas internas.');
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const message = await this.prisma.message.create({
      data: { conversationId: conv.id, direction: 'out', type: 'text', status: 'delivered', text, authorId: author.id, internal: true },
      include: { author: { select: { name: true } } },
    });
    this.gateway.emitMessage(tenantId, this.present(message));
    return this.present(message);
  }

  async setStatus(tenantId: string, id: string, status: ConversationStatus, userId: string) {
    const conv = await this.prisma.conversation.update({
      where: { id, tenantId },
      data: {
        status,
        closedAt: status === 'closed' ? new Date() : null,
        // reabrir em "in_progress" = quem reabriu assume; reabrir em "waiting" = volta para a fila
        ...(status === 'in_progress' && { assigneeId: userId }),
        ...(status === 'waiting' && { assigneeId: null }),
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

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { ConversationStatus, Prisma, WhatsAppNumber } from '@prisma/client';
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

  list(tenantId: string, q: { status?: ConversationStatus; numberId?: string; tagIds?: string[]; search?: string; cursor?: string; take?: number }) {
    const where: Prisma.ConversationWhereInput = {
      tenantId,
      ...(q.status && { status: q.status }),
      ...(q.numberId && { numberId: q.numberId }),
      ...(q.tagIds?.length && { tags: { some: { tagId: { in: q.tagIds } } } }),
      ...(q.search && {
        contact: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] },
      }),
    };
    return this.prisma.conversation.findMany({
      where,
      include: { contact: true, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, number: { select: { id: true, label: true } } },
      orderBy: { lastMessageAt: 'desc' },
      take: q.take ?? 50,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
  }

  one(tenantId: string, id: string) {
    return this.prisma.conversation.findFirstOrThrow({
      where: { id, tenantId },
      include: { contact: true, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, number: { select: { id: true, label: true, provider: true } } },
    });
  }

  async messages(tenantId: string, conversationId: string, cursor?: string, take = 50) {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, conversation: { tenantId } },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
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

  async ingestInbound(number: WhatsAppNumber, msg: InboundMessage): Promise<Message | null> {
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
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: 'waiting' },
      });
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
        raw: msg.raw as Prisma.InputJsonValue,
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
    return message;
  }

  async applyStatus(st: StatusUpdate) {
    const m = await this.prisma.message.findUnique({ where: { externalId: st.externalId }, include: { conversation: { select: { tenantId: true } } } });
    if (!m) return;
    const order = ['pending', 'sent', 'delivered', 'read', 'failed'];
    if (order.indexOf(st.status) <= order.indexOf(m.status) && st.status !== 'failed') return; // não regride
    const updated = await this.prisma.message.update({ where: { id: m.id }, data: { status: st.status, error: st.error } });
    this.gateway.emitMessage(m.conversation.tenantId, this.present(updated));
  }

  async numberConnectionChanged(number: WhatsAppNumber, c: { status: NumberStatus; qrCode?: string; phone?: string }) {
    // o número que escaneou o QR pode não ser o digitado no cadastro: corrige com o real
    const phone = c.phone && c.phone !== number.phone ? c.phone : undefined;
    await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...(phone && { phone }) } }).catch(async (err) => {
      // conflito de unique (tenantId, phone): mantém o telefone antigo, só atualiza status
      if (String(err?.code) === 'P2002') await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status } });
      else throw err;
    });
    this.gateway.emitNumber(number.tenantId, { id: number.id, status: c.status, qrCode: c.qrCode });
  }

  // ---------- outbound (API) ----------

  async send(tenantId: string, authorId: string, conversationId: string, input: Omit<OutboundMessage, 'to'> & { mediaKey?: string }) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { number: true },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.status === 'closed') throw new BadRequestException('Conversa encerrada. Reabra para responder.');

    // Regra da Meta: fora da janela de 24h só sai template aprovado
    if (conv.number.provider === 'meta' && !input.template) {
      const inWindow = conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < META_WINDOW_MS;
      if (!inWindow) throw new BadRequestException('Janela de 24h da Meta expirou. Envie um template aprovado.');
    }

    const quota = await this.usage.canSend(tenantId, input.template ? 'templates' : 'messages');
    if (!quota.ok) throw new ForbiddenException(quota.reason);

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
        assigneeId: conv.assigneeId ?? authorId,
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

  async setStatus(tenantId: string, id: string, status: ConversationStatus, userId: string) {
    const conv = await this.prisma.conversation.update({
      where: { id, tenantId },
      data: { status, closedAt: status === 'closed' ? new Date() : null, ...(status === 'in_progress' && { assigneeId: userId }) },
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

  async markRead(tenantId: string, id: string) {
    return this.prisma.conversation.update({ where: { id, tenantId }, data: { unreadCount: 0 } });
  }
}

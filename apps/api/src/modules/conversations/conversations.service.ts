import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { Conversation, ConversationEventType, ConversationOrigin, ConversationOutcome, ConversationStatus } from '@prisma/client';
import { messagePreview } from '@atendo/shared';
import type { MessageContent, MessageReaction, OutboundMessage, QuotedRef } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from '../billing/usage.service';
import { StorageService } from '../../common/storage/storage.service';
import type { Message, MessageDirection, MessageType } from '@prisma/client';
import { ConversationsGateway } from './conversations.gateway';
import { QUEUE_OUTBOUND, type OutboundJob } from '../whatsapp/queues';
import type { Permission } from '@atendo/shared';
import { narrowTo, numberFilter } from '../auth/number-scope';

/**
 * Quem está pedindo. `permissions` vem do JwtAuthGuard; o papel fica só para o dono do
 * sistema, que dá suporte entrando como o cliente e não tem perfil neste tenant.
 */
type Viewer = { id: string; role: string; permissions?: readonly Permission[]; numberIds?: readonly string[] };
const may = (v: Viewer, p: Permission) => v.role === 'super_admin' || !!v.permissions?.includes(p);


const META_WINDOW_MS = 24 * 60 * 60 * 1000;

/** O que `present()` precisa para montar `quoted`. Use em todo create/update/find que vai para o navegador. */
export const MESSAGE_INCLUDE = {
  author: { select: { name: true } },
  quotedMessage: {
    select: { id: true, direction: true, type: true, text: true, mediaName: true, content: true, author: { select: { name: true } } },
  },
} satisfies Prisma.MessageInclude;

type MessageRow = Message & {
  author?: { name: string } | null;
  quotedMessage?: { id: string; direction: MessageDirection; type: MessageType; text: string | null; mediaName: string | null; content: Prisma.JsonValue; author: { name: string } | null } | null;
};

/** WhatsApp limita o encaminhamento a 5 conversas por vez; seguimos a mesma regra. */
export const FORWARD_MAX_TARGETS = 5;

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
  present(m: MessageRow): MessageRow & { quoted: QuotedRef | null } {
    const mediaUrl = m.mediaUrl && !m.mediaUrl.startsWith('http') ? this.storage.signedUrl(m.mediaUrl) : m.mediaUrl;
    return { ...m, mediaUrl, quoted: this.quotedRef(m) };
  }

  /**
   * Citação para a bolha. Com a citada no banco, usa os dados dela (e permite scroll-to);
   * sem ela (status/story, mensagem anterior à integração), cai no `quotedPreview` salvo.
   */
  private quotedRef(m: MessageRow): QuotedRef | null {
    if (!m.quotedId) return null;
    const q = m.quotedMessage;
    return {
      messageId: q?.id ?? m.quotedMessageId ?? null,
      externalId: m.quotedId,
      direction: q?.direction ?? null,
      type: q?.type ?? null,
      preview: (q ? messagePreview({ type: q.type, text: q.text, content: q.content as unknown as MessageContent | null, mediaName: q.mediaName }) : m.quotedPreview)?.slice(0, 120) ?? null,
      // enviada pelo painel: nome do atendente. Recebida: null, o front usa o nome do contato.
      authorName: q?.direction === 'out' ? q.author?.name ?? null : null,
      fromStatus: m.quotedFromStatus,
    };
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
    q: { status?: ConversationStatus; numberId?: string; tagIds?: string[]; search?: string; origin?: ConversationOrigin; assigneeId?: string; sort?: 'recent' | 'waiting'; cursor?: string; take?: number },
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
      include: { contact: { include: { tags: { include: { tag: true } } } }, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, number: { select: { id: true, label: true, phone: true, color: true, provider: true, status: true } } },
      // "espera": quem está há mais tempo sem resposta primeiro. `nulls: 'last'` é o que joga
      // as já respondidas para o fim em vez de empilhá-las no topo
      orderBy:
        q.sort === 'waiting'
          ? [{ awaitingSince: { sort: 'asc', nulls: 'last' } }, { lastMessageAt: 'desc' }]
          : [{ lastMessageAt: 'desc' }],
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
    await this.registrar({ tenantId, conversationId: id, type: 'claimed', actorId: user.id, toStatus: 'in_progress' });
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
    await this.registrar({ tenantId, conversationId: id, type: 'transferred', actorId: by.id, targetId: target.id, fromStatus: conv.status, toStatus: updated.status });
    this.gateway.emitConversation(tenantId, updated);
    return updated;
  }

  /** Devolver para a fila (sem dono, volta a Aguardando). */
  async release(tenantId: string, id: string, by: Viewer) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (!may(by, 'conversations.transfer_any') && conv.assigneeId !== by.id) throw new ForbiddenException('Só quem está atendendo (ou quem tem permissão) pode devolver.');
    const updated = await this.prisma.conversation.update({ where: { id }, data: { assigneeId: null, status: 'waiting' } });
    await this.registrar({ tenantId, conversationId: id, type: 'released', actorId: by.id, fromStatus: conv.status, toStatus: 'waiting' });
    this.gateway.emitConversation(tenantId, updated);
    return updated;
  }

  async one(tenantId: string, id: string) {
    const row = await this.prisma.conversation.findFirstOrThrow({
      where: { id, tenantId },
      include: { contact: { include: { tags: { include: { tag: true } } } }, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, number: { select: { id: true, label: true, phone: true, color: true, provider: true, status: true } } },
    });
    return this.presentContact(row);
  }

  async messages(tenantId: string, conversationId: string, cursor?: string, take = 50) {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, conversation: { tenantId } },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: MESSAGE_INCLUDE,
    });
    return rows.map((m) => this.present(m));
  }

  /**
   * Envio pelo sistema (fluxos de automação): sem autor humano, não assume a conversa,
   * respeita quota e janela de 24h, passa pela mesma fila.
   */
  async sendAsSystem(conversationId: string, text?: string, media?: { key: string; type: 'image' | 'document' | 'audio' | 'video'; name?: string; voice?: boolean }, interactive?: import('@atendo/shared').InteractiveMenu) {
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
      data: { conversationId, numberId: conv.numberId, direction: 'out', type: media ? media.type : 'text', status: 'pending', text: shown, mediaUrl: media?.key, mediaName: media?.name, raw: interactive ? ({ interactive, body: text } as unknown as Prisma.InputJsonValue) : media?.voice === false ? { voice: false } : undefined },
    });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastMessagePreview: messagePreview({ type: media ? media.type : 'text', text: shown, mediaName: media?.name }).slice(0, 120), awaitingSince: null } });
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
    const antes = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { status: true } });
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status,
        closedAt: status === 'closed' ? new Date() : null,
        ...(status === 'waiting' && { assigneeId: null }),
        // sair de encerrado começa outro atendimento: o desfecho do anterior fica congelado no
        // histórico, e deixá-lo aqui marcaria o atendimento novo como se já tivesse resultado
        ...(status !== 'closed' && { outcome: 'none' as const, outcomeValue: null, outcomeReason: null, outcomeAt: null, outcomeById: null }),
      },
    });
    // ator nulo: foi o fluxo, não uma pessoa — e a diferença importa na auditoria
    await this.registrar({ tenantId: conv.tenantId, conversationId, type: tipoDaTransicao(antes?.status, status), fromStatus: antes?.status, toStatus: status, reason: 'automação' });
    this.gateway.emitConversation(conv.tenantId, conv);
    return conv;
  }

  /**
   * Envio do atendente. Sai SEMPRE pelo número da conversa, lido do banco — nada no payload escolhe
   * o número, e não há fallback para outro: se o canal não pode enviar, a mensagem não sai.
   * `expectedNumberId` é o canal que a tela mostrava; se a conversa não está mais nele, 409 sem enviar.
   */
  async send(tenantId: string, author: Viewer, conversationId: string, input: Omit<OutboundMessage, 'to'> & { mediaKey?: string; forwarded?: boolean; expectedNumberId?: string }) {
    const authorId = author.id;
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { number: true },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.status === 'closed') throw new BadRequestException('Conversa encerrada. Reabra para responder.');
    // número de outro tenant nunca deveria acontecer, mas se acontecer é bloqueio, não envio
    if (!conv.number || conv.number.tenantId !== tenantId || !conv.number.isActive) {
      throw new UnprocessableEntityException('Esta conversa não tem um número de WhatsApp válido para responder.');
    }
    if (input.expectedNumberId && input.expectedNumberId !== conv.numberId) {
      throw new ConflictException({ code: 'number_changed', message: `O canal desta conversa mudou para "${conv.number.label}". Confira antes de enviar de novo.` });
    }
    if (conv.number.status !== 'connected') {
      throw new UnprocessableEntityException(`O número "${conv.number.label}" está desconectado. Conecte-o em Números para responder.`);
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

    const quoted = input.quotedExternalId
      ? await this.prisma.message.findFirst({ where: { externalId: input.quotedExternalId, conversation: { tenantId } }, select: { id: true } })
      : null;
    const message = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        numberId: conv.numberId,
        direction: 'out',
        type: input.template ? 'template' : input.type,
        status: 'pending',
        text: input.text,
        mediaUrl: input.mediaKey ?? input.media?.url,
        mediaMime: input.media?.mimeType,
        mediaName: input.media?.fileName,
        quotedId: input.quotedExternalId,
        quotedMessageId: quoted?.id,
        // só no nosso histórico: nem a Cloud API nem a Evolution aceitam marcar o envio como
        // encaminhado, então no celular do contato chega como mensagem comum
        forwarded: input.forwarded ?? false,
        authorId,
        raw: input.template ? ({ template: input.template } as Prisma.InputJsonValue) : undefined,
      },
      include: MESSAGE_INCLUDE,
    });

    const updatedConv = await this.prisma.conversation.update({
      where: { id: conv.id },
      data: {
        status: conv.status === 'waiting' ? 'in_progress' : conv.status,
        lastMessageAt: new Date(),
        lastMessagePreview: messagePreview({ type: input.template ? 'template' : input.type, text: input.text, mediaName: input.media?.fileName }).slice(0, 120),
        awaitingSince: null,
        unreadCount: 0,
      },
    });

    await this.outbound.add('send', { messageId: message.id });
    this.gateway.emitMessage(tenantId, this.present(message));
    this.gateway.emitConversation(tenantId, updatedConv);
    return this.present(message);
  }

  /**
   * Encaminha uma mensagem para outras conversas. Cada envio é um `send` normal — mesma
   * quota, janela da Meta, posse da conversa ("responder = assumir") e ledger —, só marcado
   * como encaminhado. Falha numa conversa não impede as outras: devolve o que saiu e o que não.
   *
   * O que o provider não sabe mandar do jeito original vira texto: localização sai como link do
   * Maps, contato como nome + telefone, botões/lista como o texto da mensagem.
   */
  async forward(tenantId: string, author: Viewer, conversationId: string, messageId: string, targetIds: string[]) {
    const src = await this.prisma.message.findFirst({ where: { id: messageId, conversationId, internal: false, conversation: { tenantId } } });
    if (!src) throw new NotFoundException('Mensagem não encontrada');
    const input = this.forwardInput(tenantId, src);

    // o ConversationScopeGuard só olha `:id` (a origem); os destinos vêm no corpo e o recorte
    // por número fica aqui — conversa fora do escopo responde igual a inexistente
    const escopo = numberFilter(author);
    const pedidos = [...new Set(targetIds)].filter((id) => id !== conversationId).slice(0, FORWARD_MAX_TARGETS);
    const visiveis = await this.prisma.conversation.findMany({ where: { id: { in: pedidos }, tenantId, ...(escopo && { numberId: escopo }) }, select: { id: true } });
    const ok = new Set(visiveis.map((v) => v.id));

    const sent: ReturnType<ConversationsService['present']>[] = [];
    const failed: { conversationId: string; error: string }[] = [];
    for (const id of pedidos) {
      if (!ok.has(id)) { failed.push({ conversationId: id, error: 'Conversa não encontrada' }); continue; }
      try {
        sent.push(await this.send(tenantId, author, id, input));
      } catch (err) {
        failed.push({ conversationId: id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { sent, failed };
  }

  private forwardInput(tenantId: string, m: Message): Parameters<ConversationsService['send']>[3] {
    const media = ['image', 'video', 'audio', 'document'] as const;
    if ((media as readonly string[]).includes(m.type)) {
      // a mídia é reaproveitada do nosso storage; ainda baixando (ou falhou) não há o que mandar
      if (!m.mediaUrl || !m.mediaUrl.startsWith(`media/${tenantId}/`)) throw new BadRequestException('A mídia desta mensagem ainda não está disponível para encaminhar.');
      return {
        type: m.type as (typeof media)[number],
        text: m.text ?? undefined,
        mediaKey: m.mediaUrl,
        media: { url: m.mediaUrl, mimeType: m.mediaMime ?? undefined, fileName: m.mediaName ?? undefined },
        forwarded: true,
      };
    }
    if (m.type === 'sticker') throw new BadRequestException('Figurinha não pode ser encaminhada.');
    const text = textoParaEncaminhar(m.text, m.content as unknown as MessageContent | null);
    if (!text) throw new BadRequestException('Esta mensagem não tem conteúdo para encaminhar.');
    return { type: 'text', text, forwarded: true };
  }

  /** Reenvia uma mensagem que falhou: volta para pending e enfileira de novo. */
  async resend(tenantId: string, messageId: string) {
    const m = await this.prisma.message.findFirst({ where: { id: messageId, direction: 'out', status: 'failed', conversation: { tenantId } }, include: { conversation: { include: { number: true } } } });
    if (!m) throw new NotFoundException('Mensagem não encontrada ou não está com falha');
    if (m.conversation.number.status !== 'connected') throw new BadRequestException(`O número "${m.conversation.number.label}" está desconectado.`);
    const updated = await this.prisma.message.update({ where: { id: m.id }, data: { status: 'pending', error: null }, include: MESSAGE_INCLUDE });
    await this.outbound.add('send', { messageId: m.id });
    this.gateway.emitMessage(tenantId, this.present(updated));
    return this.present(updated);
  }

  /**
   * Confere se o atendente pode reagir a esta mensagem e devolve o que o provider precisa.
   * Mesmas regras de responder (conversa aberta, número conectado, janela da Meta, conversa
   * de outra pessoa não), mas sem assumir a conversa: reagir não é atender.
   */
  async reactionTarget(tenantId: string, author: Viewer, conversationId: string, messageId: string) {
    const m = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, internal: false, conversation: { tenantId } },
      include: { conversation: { include: { number: true, contact: { select: { phone: true } } } } },
    });
    if (!m) throw new NotFoundException('Mensagem não encontrada');
    if (!m.externalId || m.status === 'pending' || m.status === 'failed') throw new BadRequestException('Essa mensagem não chegou ao WhatsApp — não dá para reagir a ela.');
    const conv = m.conversation;
    if (conv.status === 'closed') throw new BadRequestException('Conversa encerrada. Reabra para reagir.');
    if (conv.number.status !== 'connected') throw new BadRequestException(`O número "${conv.number.label}" está desconectado.`);
    if (conv.assigneeId && conv.assigneeId !== author.id) throw new ConflictException('Outro atendente está atendendo esta conversa.');
    // reação é mensagem livre para a Meta: fora da janela de 24h ela recusa
    if (conv.number.provider === 'meta') {
      const inWindow = conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < META_WINDOW_MS;
      if (!inWindow) throw new BadRequestException('Janela de 24h da Meta expirou — não dá para reagir.');
    }
    return { messageId: m.id, numberId: conv.numberId, to: conv.contact.phone, targetExternalId: m.externalId, targetFromMe: m.direction === 'out' };
  }

  /**
   * Grava a reação de um lado na mensagem e avisa o painel. No 1:1 cada lado tem no máximo uma:
   * a nova substitui a anterior do mesmo lado, e emoji vazio retira. Reação não é mensagem —
   * não passa pelo `UsageService`, não é cobrada.
   */
  async setReaction(tenantId: string, messageId: string, r: { fromMe: boolean; emoji: string; at: Date }) {
    const m = await this.prisma.message.findFirst({ where: { id: messageId, conversation: { tenantId } }, select: { reactions: true } });
    if (!m) return null;
    const atuais = (Array.isArray(m.reactions) ? m.reactions : []) as unknown as MessageReaction[];
    const reactions = [
      ...atuais.filter((x) => x.fromMe !== r.fromMe),
      ...(r.emoji ? [{ emoji: r.emoji, fromMe: r.fromMe, at: r.at.toISOString() }] : []),
    ];
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { reactions: reactions.length ? (reactions as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
      include: MESSAGE_INCLUDE,
    });
    const presented = this.present(updated);
    this.gateway.emitMessage(tenantId, presented);
    return presented;
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

  /** Nota interna do sistema (sem autor): o robô avisando a equipe. Nunca vai ao WhatsApp. */
  async systemNote(conversationId: string, text: string) {
    const conv = await this.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { id: true, tenantId: true } });
    const message = await this.prisma.message.create({
      data: { conversationId: conv.id, direction: 'out', type: 'text', status: 'delivered', text, internal: true },
      include: { author: { select: { name: true } } },
    });
    this.gateway.emitMessage(conv.tenantId, this.present(message));
    return message;
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

    const antes = await this.prisma.conversation.findFirst({ where: { id, tenantId }, select: { status: true } });
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
    // o desfecho vai copiado para o evento: reabrir limpa o da conversa, e o fechamento que
    // já entrou no relatório do mês não pode mudar depois
    await this.registrar({
      tenantId,
      conversationId: id,
      type: tipoDaTransicao(antes?.status, status),
      actorId: userId,
      fromStatus: antes?.status,
      toStatus: status,
      outcome: status === 'closed' ? (outcome?.outcome ?? 'none') : null,
      outcomeValue: conv.outcomeValue,
      reason: status === 'closed' ? outcome?.reason?.trim() || null : null,
    });
    this.gateway.emitConversation(tenantId, conv);
    return conv;
  }

  /**
   * Encerrar vários atendimentos numa tacada.
   *
   * Existe porque a fila de "Aguardando" acumula gente que nunca respondeu, e fechar uma por
   * uma é meia hora de cliques — na prática o atendente desistia e a fila virava ruído, o que
   * tira o sentido do próprio semáforo.
   *
   * O recorte de quem pode fechar o quê é feito **aqui**, não no guard: o guard olha
   * `:id` na rota e esta chamada traz uma lista no corpo. Então a cláusula repete as duas
   * regras da listagem — só números que a pessoa opera, e atendente comum só mexe no que é
   * dele ou está sem dono. Id de fora do recorte não dá erro, só não entra na conta; a
   * resposta diz quantos ficaram de fora para a tela poder avisar.
   *
   * Sem disparo de fluxo de propósito: um fluxo de encerramento aplicado a cinquenta conversas
   * é envio em massa, e isso tem (ou terá) tela própria, com limite diário e opt-out.
   */
  async closeMany(tenantId: string, viewer: Viewer, ids: string[], desfecho?: { outcome: ConversationOutcome; reason?: string }) {
    const pedidos = [...new Set(ids)];
    const escopo = numberFilter(viewer);
    const alvos = await this.prisma.conversation.findMany({
      where: {
        id: { in: pedidos },
        tenantId,
        // já encerrada não é erro nem reencerra: fechar duas vezes mudaria a data e estragaria
        // o tempo de atendimento no relatório
        status: { not: 'closed' },
        ...(escopo && { numberId: escopo }),
        ...(may(viewer, 'conversations.view_all') ? {} : { OR: [{ assigneeId: viewer.id }, { assigneeId: null }] }),
      },
      select: { id: true, status: true },
    });
    if (!alvos.length) return { closed: 0, ignored: pedidos.length };

    const idsAlvo = alvos.map((a) => a.id);
    // mesma razão do `registrar`: dono do sistema não tem linha em `users` deste tenant
    const ator = (await this.prisma.user.findFirst({ where: { id: viewer.id, tenantId }, select: { id: true } }))?.id ?? null;
    await this.prisma.conversation.updateMany({
      where: { id: { in: idsAlvo } },
      data: {
        status: 'closed',
        closedAt: new Date(),
        // valor de venda não entra em massa: ele é por conversa, e um número repetido em
        // cinquenta atendimentos inflaria o faturamento do relatório
        ...(desfecho && desfecho.outcome !== 'none'
          ? {
              outcome: desfecho.outcome,
              outcomeReason: desfecho.outcome === 'lost' ? desfecho.reason?.trim() || null : null,
              outcomeAt: new Date(),
              outcomeById: viewer.id,
            }
          : {}),
      },
    });

    await this.prisma.conversationEvent.createMany({
      // "em massa" fica no registro: na auditoria, trinta encerramentos no mesmo segundo
      // precisam ser distinguíveis de trinta atendimentos de verdade
      data: alvos.map((a) => ({
        tenantId,
        conversationId: a.id,
        type: 'closed' as const,
        actorId: ator,
        fromStatus: a.status,
        toStatus: 'closed' as const,
        outcome: desfecho?.outcome ?? 'none',
        reason: [desfecho?.outcome === 'lost' ? desfecho.reason?.trim() : null, 'encerrado em massa'].filter(Boolean).join(' · '),
      })),
    });

    // cada conversa precisa ir pelo socket: quem está com o painel aberto vê a fila esvaziar
    const fechadas = await this.prisma.conversation.findMany({ where: { id: { in: idsAlvo } } });
    for (const c of fechadas) this.gateway.emitConversation(tenantId, c);
    this.log.log(`${fechadas.length} atendimento(s) encerrados em massa por ${viewer.id}`);
    return { closed: fechadas.length, ignored: pedidos.length - fechadas.length };
  }

  // ---------- histórico (auditoria) ----------

  /**
   * Grava o que aconteceu com o atendimento.
   *
   * Não é try/catch de propósito: auditoria que engole o próprio erro é pior que auditoria
   * nenhuma, porque o relatório fica plausível e errado. Se não deu para registrar, a ação
   * falha e aparece.
   */
  private async registrar(e: {
    tenantId: string;
    conversationId: string;
    type: ConversationEventType;
    actorId?: string | null;
    targetId?: string | null;
    fromStatus?: ConversationStatus | null;
    toStatus?: ConversationStatus | null;
    outcome?: ConversationOutcome | null;
    outcomeValue?: Prisma.Decimal | null;
    reason?: string | null;
  }) {
    // super_admin não tem linha em `users` deste tenant: entra como sistema, senão a FK quebra
    const actorId = e.actorId && (await this.prisma.user.findFirst({ where: { id: e.actorId, tenantId: e.tenantId }, select: { id: true } })) ? e.actorId : null;
    await this.prisma.conversationEvent.create({ data: { ...e, actorId } });
  }

  /** Linha do tempo do atendimento, do mais recente para o mais antigo. */
  async events(tenantId: string, conversationId: string) {
    await this.prisma.conversation.findFirstOrThrow({ where: { id: conversationId, tenantId }, select: { id: true } });
    return this.prisma.conversationEvent.findMany({
      where: { conversationId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { actor: { select: { id: true, name: true } }, target: { select: { id: true, name: true } } },
    });
  }

  /**
   * Tags do atendimento. A principal (coluna no Kanban) sobrevive à troca enquanto continuar
   * na lista; se saiu — ou se ainda não havia — a primeira tag de coluna, na ordem do quadro,
   * assume. Sem isso, marcar uma etapa pelo chat não moveria o card.
   */
  async setTags(tenantId: string, id: string, tagIds: string[]) {
    await this.prisma.conversation.findFirstOrThrow({ where: { id, tenantId } });
    // só tags deste tenant: o id vem do corpo da requisição
    const validas = await this.prisma.tag.findMany({
      where: { id: { in: [...new Set(tagIds)] }, tenantId },
      select: { id: true, isKanban: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    await this.prisma.$transaction(async (tx) => {
      await this.lockConversation(tx, id);
      const atual = await tx.conversationTag.findFirst({ where: { conversationId: id, isPrimary: true }, select: { tagId: true } });
      const principal = atual && validas.some((t) => t.id === atual.tagId) ? atual.tagId : validas.find((t) => t.isKanban)?.id ?? null;
      await tx.conversationTag.deleteMany({ where: { conversationId: id } });
      await tx.conversationTag.createMany({ data: validas.map((t) => ({ conversationId: id, tagId: t.id, isPrimary: t.id === principal })) });
    });
    const conv = await this.prisma.conversation.findUniqueOrThrow({ where: { id }, include: { tags: { include: { tag: true } } } });
    // o Kanban e as outras telas abertas precisam ver a etapa mudar
    this.gateway.emitConversation(tenantId, conv);
    return conv;
  }

  /**
   * Troca a tag principal — é o "mover card" do Kanban. A antiga continua no atendimento,
   * rebaixada a secundária; a nova entra se ainda não estava. `null` tira da etapa.
   * Só tag de coluna (`isKanban`) pode ser principal: as outras não têm onde aparecer no quadro.
   */
  async setPrimaryTag(tenantId: string, id: string, tagId: string | null) {
    await this.prisma.conversation.findFirstOrThrow({ where: { id, tenantId } });
    if (tagId) {
      const tag = await this.prisma.tag.findFirst({ where: { id: tagId, tenantId }, select: { isKanban: true } });
      if (!tag) throw new NotFoundException('Tag não encontrada');
      if (!tag.isKanban) throw new BadRequestException('Essa tag não é uma etapa do Kanban');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockConversation(tx, id);
      await tx.conversationTag.updateMany({ where: { conversationId: id, isPrimary: true }, data: { isPrimary: false } });
      if (tagId) {
        await tx.conversationTag.upsert({
          where: { conversationId_tagId: { conversationId: id, tagId } },
          create: { conversationId: id, tagId, isPrimary: true },
          update: { isPrimary: true },
        });
      }
    });
    const conv = await this.prisma.conversation.findUniqueOrThrow({ where: { id }, include: { tags: { include: { tag: true } } } });
    this.gateway.emitConversation(tenantId, conv);
    return conv;
  }

  /**
   * Trava a linha da conversa até o fim da transação. Duas abas movendo o mesmo card ao mesmo
   * tempo, sem isto, podiam terminar com duas tags principais — o atendimento em duas colunas.
   */
  private async lockConversation(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT 1 FROM "conversations" WHERE "id" = ${id} FOR UPDATE`);
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

/**
 * Que nome dar à mudança de status. Reabrir é o caso que importa: sem ele, um atendimento
 * fechado e reaberto apareceria como dois encerramentos no relatório.
 */
export function tipoDaTransicao(de: ConversationStatus | null | undefined, para: ConversationStatus): ConversationEventType {
  if (para === 'closed') return 'closed';
  if (de === 'closed') return 'reopened';
  return para === 'in_progress' ? 'claimed' : 'released';
}

/**
 * Desde quando o contato espera resposta, ao chegar mais uma mensagem dele.
 *
 * Cinco mensagens seguidas são **uma** espera só, e quem mede o atraso é a primeira: trocar
 * pela mais recente zeraria o relógio a cada "oi?" do cliente — justamente quem está sendo
 * mais ignorado apareceria como o mais recente.
 */
export function inicioDaEspera(atual: Date | null, chegada: Date): Date {
  return atual ?? chegada;
}

/** Conteúdo estruturado → texto, para encaminhar o que o provider não manda no formato original. */
export function textoParaEncaminhar(text: string | null, content: MessageContent | null): string | undefined {
  if (content?.kind === 'location') {
    const titulo = [content.name, content.address].filter(Boolean).join(' — ');
    const link = `https://www.google.com/maps?q=${content.lat},${content.lng}`;
    return [text, titulo && `📍 ${titulo}`, link].filter(Boolean).join('\n');
  }
  if (content?.kind === 'contacts') {
    const linhas = content.contacts.map((c) => `👤 ${c.name}${c.phones.length ? `\n${c.phones.map((p) => `+${p.replace(/^\+/, '')}`).join('\n')}` : ''}`);
    return [text, ...linhas].filter(Boolean).join('\n\n');
  }
  return text?.trim() || undefined;
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { Conversation, ConversationEventType, ConversationOrigin, ConversationOutcome, ConversationStatus } from '@prisma/client';
import type { OutboundMessage } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from '../billing/usage.service';
import { StorageService } from '../../common/storage/storage.service';
import type { Message } from '@prisma/client';
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
      include: { contact: { include: { tags: { include: { tag: true } } } }, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, number: { select: { id: true, label: true } } },
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
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastMessagePreview: (shown ?? `[${media?.type}]`).slice(0, 120), awaitingSince: null } });
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
        awaitingSince: null,
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

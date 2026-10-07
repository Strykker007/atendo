import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { Conversation, ConversationEventType, ConversationOrigin, ConversationOutcome, ConversationStatus } from '@prisma/client';
import { DELETED_MESSAGE_LABEL, MESSAGE_EDIT_WINDOW_MS, MESSAGE_REVOKE_WINDOW_MS, OWN_MESSAGE_DELETE_WINDOW_MS, PLAN_FEATURE_LABEL, messagePreview } from '@atendo/shared';
import type { DeletedMessageOriginal, MessageContent, MessageReaction, MessageTemplate, OutboundMessage, QuotedRef, TemplateValues } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from '../billing/usage.service';
import { StorageService } from '../../common/storage/storage.service';
import type { Message, MessageDirection, MessageType } from '@prisma/client';
import { ConversationsGateway } from './conversations.gateway';
import { QUEUE_OUTBOUND, type OutboundJob } from '../whatsapp/queues';
import { enqueueOutbound, promoteNext, requeueSeq } from '../whatsapp/send-queue';
import type { Permission } from '@atendo/shared';
import { canUseNumber, narrowTo, numberFilter } from '../auth/number-scope';
import { buildTemplateSend } from '../whatsapp/templates';
import { phoneVariants } from './phone-variants';
import { canSeeDepartment, departmentWhere } from '../auth/department-scope';
import { BOT_PAUSE_CLEAR } from './bot-pause';
import { InterpolationService } from '../../common/interpolation/interpolation.service';
import { textSearch } from '../../common/text-search';
import { interpolate } from '../flows/answer';
import { spin } from './spin';
import { COLD_UNOFFICIAL_MESSAGE, isWarm } from './cold-send';

/**
 * Quem está pedindo. `permissions` vem do JwtAuthGuard; o papel fica só para o dono do
 * sistema, que dá suporte entrando como o cliente e não tem perfil neste tenant.
 */
/** Consulta "este telefone tem WhatsApp?" no provider do número (null = não sabe). */
type PhoneCheck = (numberId: string, phone: string) => Promise<boolean | null>;
type Viewer = { id: string; role: string; permissions?: readonly Permission[]; numberIds?: readonly string[]; departmentIds?: readonly string[] };

/** O que a lista e o cabeçalho do chat mostram do departamento (etiqueta com cor). */
export const DEPARTMENT_SELECT = { id: true, name: true, color: true, isActive: true } as const;
const may = (v: Viewer, p: Permission) => v.role === 'super_admin' || !!v.permissions?.includes(p);


const META_WINDOW_MS = 24 * 60 * 60 * 1000;
/** O contato escreveu nas últimas 24h? Fora disso a Meta só aceita template. */
const inMetaWindow = (lastInboundAt: Date | null | undefined) => !!lastInboundAt && Date.now() - lastInboundAt.getTime() < META_WINDOW_MS;

/** O que `present()` precisa para montar `quoted`. Use em todo create/update/find que vai para o navegador. */
export const MESSAGE_INCLUDE = {
  author: { select: { name: true } },
  quotedMessage: {
    select: { id: true, direction: true, type: true, text: true, mediaName: true, content: true, deletedAt: true, author: { select: { name: true } } },
  },
} satisfies Prisma.MessageInclude;

export type MessageRow = Message & {
  author?: { name: string } | null;
  quotedMessage?: { id: string; direction: MessageDirection; type: MessageType; text: string | null; mediaName: string | null; content: Prisma.JsonValue; deletedAt?: Date | null; author: { name: string } | null } | null;
};

/**
 * Mensagem já pronta para o navegador: é o que sai por HTTP e por socket.
 *
 * `queueSeq` (BigInt) e `raw` ficam de fora de propósito — ver `present()`. O tipo existe
 * para o gateway exigir **isto**, e não a linha do Prisma: enquanto a assinatura aceitava
 * `Message`, qualquer coluna nova entrava no payload sem ninguém decidir.
 */
export type PresentedMessage = Omit<MessageRow, 'queueSeq' | 'raw'> & { quoted: QuotedRef | null };

/** WhatsApp limita o encaminhamento a 5 conversas por vez; seguimos a mesma regra. */
export const FORWARD_MAX_TARGETS = 5;

/**
 * O que fazer para apagar uma mensagem (docs/apagar-mensagens.md). Quem fala com o provider é o
 * controller (como na reação): o service decide, o `NumbersService` executa, `markDeleted` grava.
 */
export interface DeletionPlan {
  messageId: string;
  conversationId: string;
  /** ainda na fila de envio: cancelar em vez de apagar no WhatsApp */
  cancelPending: boolean;
  /** pedir "apagar para todos" ao provider; null = só no painel */
  revoke: { numberId: string; to: string; externalId: string } | null;
  /** por que vai ser apagada só no painel — volta para a tela avisar o atendente */
  notice: string | null;
}

const CANCELED_SEND = 'Envio cancelado: a mensagem foi apagada antes de sair.';
export const DELETE_NOTICE = {
  inbound: 'Mensagem recebida não sai do celular do contato: foi apagada só no painel.',
  expired: 'Passou o prazo do WhatsApp para apagar para todos (cerca de 2 dias): a mensagem foi apagada só no painel e continua no celular do contato.',
  offline: 'O número está desconectado: a mensagem foi apagada só no painel e continua no celular do contato.',
  unsupported: 'A API oficial da Meta não permite apagar mensagens enviadas: a mensagem foi apagada só no painel e continua no celular do contato.',
  refused: (motivo: string) => `O WhatsApp recusou apagar para todos (${motivo}): a mensagem foi apagada só no painel e continua no celular do contato.`,
  alreadySent: 'A mensagem saiu antes do cancelamento: ela chegou ao contato e foi apagada só no painel.',
} as const;

@Injectable()
export class ConversationsService {
  private readonly log = new Logger(ConversationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly gateway: ConversationsGateway,
    private readonly storage: StorageService,
    private readonly interpolation: InterpolationService,
    @InjectQueue(QUEUE_OUTBOUND) private readonly outbound: Queue<OutboundJob>,
  ) {}

  /**
   * Message.mediaUrl guarda a CHAVE no storage (privada). Antes de sair para o navegador
   * (HTTP ou socket) vira uma URL assinada e temporária.
   */
  present(m: MessageRow): PresentedMessage {
    // `queueSeq` é BigInt e **nada** que fala com o navegador sabe serializar: `JSON.stringify`
    // lança (a listagem virava 500) e o msgpack do adapter Redis também (o emit em tempo real
    // morria dentro do `ingestInbound`). `raw` é o payload cru do provider — não tem por que
    // sair daqui. Os dois ficam de fora explicitamente para o spread não os trazer de volta.
    const { queueSeq: _queueSeq, raw: _raw, ...rest } = m;
    if (m.deletedAt) {
      // Apagada: o original continua no banco (auditoria) e NÃO sai daqui — nem por socket,
      // que vai para a sala do tenant inteiro. Quem tem `conversations.view_deleted` lê por
      // `deletedOriginal()`. Reação e citação também saem: as duas carregam pedaço do conteúdo.
      return { ...rest, text: null, mediaUrl: null, mediaMime: null, mediaName: null, content: null, reactions: null, error: null, quotedId: null, quotedMessageId: null, quotedPreview: null, quotedMediaUrl: null, quotedMediaMime: null, quotedMessage: null, quoted: null };
    }
    const mediaUrl = m.mediaUrl && !m.mediaUrl.startsWith('http') ? this.storage.signedUrl(m.mediaUrl) : m.mediaUrl;
    return { ...rest, mediaUrl, quoted: this.quotedRef(m) };
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
      preview: (q?.deletedAt ? DELETED_MESSAGE_LABEL : q ? messagePreview({ type: q.type, text: q.text, content: q.content as unknown as MessageContent | null, mediaName: q.mediaName }) : m.quotedPreview)?.slice(0, 120) ?? null,
      // enviada pelo painel: nome do atendente. Recebida: null, o front usa o nome do contato.
      authorName: q?.direction === 'out' ? q.author?.name ?? null : null,
      fromStatus: m.quotedFromStatus,
      mediaUrl: m.quotedMediaUrl ? this.storage.signedUrl(m.quotedMediaUrl) : null,
      mediaType: m.quotedMediaMime ? (m.quotedMediaMime.startsWith('video/') ? 'video' : 'image') : null,
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
    q: { status?: ConversationStatus; numberId?: string; departmentId?: string; tagIds?: string[]; search?: string; origin?: ConversationOrigin; assigneeId?: string; sort?: 'recent' | 'waiting'; cursor?: string; take?: number },
  ) {
    // quem vê os atendimentos da equipe é decidido por permissão, não pelo papel: é isso que
    // permite um "atendente líder" enxergar a equipe sem virar gerente
    const isAdmin = may(viewer, 'conversations.view_all');
    const scoped = narrowTo(viewer, q.numberId);
    // departamento: escopo do usuário ∩ filtro da tela. Vai num AND porque o filtro de tags
    // abaixo também usa OR, e dois OR no mesmo nível se sobrescreveriam
    const dept = departmentWhere(viewer, q.departmentId);
    const ownership: Prisma.ConversationWhereInput =
      q.assigneeId && isAdmin ? { assigneeId: q.assigneeId } : !isAdmin && q.status === 'in_progress' ? { assigneeId: viewer.id } : {};
    const where: Prisma.ConversationWhereInput = {
      tenantId,
      // número excluído: as conversas ficam guardadas para voltar quando ele for recadastrado
      number: { deletedAt: null },
      ...(q.status && { status: q.status }),
      ...(q.origin && { origin: q.origin }),
      ...ownership,
      // o número pedido é interseccionado com o escopo do usuário; `null` = pediu um número
      // que ele não opera, e aí a lista vem vazia em vez de ignorar o pedido
      ...(scoped === null ? { numberId: '-' } : scoped !== undefined ? { numberId: scoped } : {}),
      ...(dept && { AND: [dept] }),
      // tag da conversa OU tag do contato
      ...(q.tagIds?.length && { OR: [{ tags: { some: { tagId: { in: q.tagIds } } } }, { contact: { tags: { some: { tagId: { in: q.tagIds } } } } }] }),
      // nome/e-mail/telefone do contato, sem acento e por palavras (common/text-search.ts)
      ...(q.search && { contact: textSearch(q.search) }),
    };
    const rows = await this.prisma.conversation.findMany({
      where,
      include: { contact: { include: { tags: { include: { tag: true } } } }, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, botPausedBy: { select: { id: true, name: true } }, department: { select: DEPARTMENT_SELECT }, number: { select: { id: true, label: true, phone: true, color: true, provider: true, status: true } } },
      // "espera": quem está há mais tempo sem resposta primeiro. `nulls: 'last'` é o que joga
      // as já respondidas para o fim em vez de empilhá-las no topo
      orderBy:
        q.sort === 'waiting'
          ? [{ awaitingSince: { sort: 'asc', nulls: 'last' } }, { lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
          // `nulls: 'last'`: no Postgres o DESC põe nulo PRIMEIRO, e conversa sem mensagem
          // (criada e nunca usada) encabeçava a lista para sempre. `id` desempata: com hora
          // igual (histórico importado em lote) a ordem variava entre páginas e o cursor pulava linha
          : [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: q.take ?? 50,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
    return rows.map((r) => this.presentContact(r));
  }

  /** Contadores dos três filtros principais (opcionalmente por número e departamento). */
  async counts(tenantId: string, viewer: Viewer, numberId?: string, departmentId?: string) {
    const scoped = narrowTo(viewer, numberId);
    const dept = departmentWhere(viewer, departmentId);
    const base: Prisma.ConversationWhereInput = { tenantId, number: { deletedAt: null }, ...(scoped === null ? { numberId: '-' } : scoped !== undefined ? { numberId: scoped } : {}), ...dept };
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

  /**
   * Transferir para outro departamento (ou tirar de departamento, `null`).
   *
   * Vai para a **fila** do departamento: sem dono e em Aguardando — quem atendia normalmente
   * não é do outro departamento, e deixar o atendimento com ele esconderia a conversa de
   * quem deveria pegá-la. Encerrada continua encerrada (só muda o departamento).
   * Mesma regra de quem pode do `release`: o dono, quem tem `transfer_any`, ou qualquer um
   * que veja a conversa enquanto ela está sem dono.
   */
  async setDepartment(tenantId: string, id: string, departmentId: string | null, by: Viewer) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, tenantId }, include: { department: { select: { name: true } } } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.assigneeId && conv.assigneeId !== by.id && !may(by, 'conversations.transfer_any')) throw new ForbiddenException('Só quem está atendendo (ou quem tem permissão) pode transferir.');
    if ((conv.departmentId ?? null) === departmentId) return this.one(tenantId, id);
    // departamento de outro cliente ou desativado não entra: o id vem do corpo da requisição
    const target = departmentId ? await this.prisma.department.findFirst({ where: { id: departmentId, tenantId, isActive: true }, select: { id: true, name: true } }) : null;
    if (departmentId && !target) throw new NotFoundException('Departamento não encontrado ou desativado');
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: { departmentId: target?.id ?? null, ...(conv.status !== 'closed' && { assigneeId: null, status: 'waiting' }) },
    });
    await this.registrar({ tenantId, conversationId: id, type: 'department_changed', actorId: by.id, fromStatus: conv.status, toStatus: updated.status, reason: departmentChangeReason(conv.department?.name, target?.name) });
    this.gateway.emitConversation(tenantId, updated);
    return this.one(tenantId, id);
  }

  /**
   * Mesma troca feita pelo fluxo (bloco Distribuidor/Ação). Não mexe em dono nem status —
   * quem decide isso é o resto do fluxo (o Distribuidor atribui logo em seguida).
   * Devolve false se o departamento não existe ou está desativado.
   */
  async setDepartmentSystem(conversationId: string, departmentId: string | null): Promise<boolean> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { department: { select: { name: true } } } });
    if (!conv) return false;
    const target = departmentId ? await this.prisma.department.findFirst({ where: { id: departmentId, tenantId: conv.tenantId, isActive: true }, select: { id: true, name: true } }) : null;
    if (departmentId && !target) return false;
    if ((conv.departmentId ?? null) === (target?.id ?? null)) return true;
    const updated = await this.prisma.conversation.update({ where: { id: conversationId }, data: { departmentId: target?.id ?? null } });
    await this.registrar({ tenantId: conv.tenantId, conversationId, type: 'department_changed', actorId: null, reason: departmentChangeReason(conv.department?.name, target?.name) });
    this.gateway.emitConversation(conv.tenantId, updated);
    return true;
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
      include: { contact: { include: { tags: { include: { tag: true } } } }, tags: { include: { tag: true } }, assignee: { select: { id: true, name: true } }, botPausedBy: { select: { id: true, name: true } }, department: { select: DEPARTMENT_SELECT }, number: { select: { id: true, label: true, phone: true, color: true, provider: true, status: true } } },
    });
    return this.presentContact(row);
  }

  async messages(tenantId: string, conversationId: string, cursor?: string, take = 50) {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, conversation: { tenantId } },
      // o horário vem do WhatsApp em segundos: no mesmo segundo, desempata pela ordem de chegada
      // (sem isso o banco devolvia empatadas em qualquer ordem e a paginação podia pular/repetir)
      orderBy: [{ createdAt: 'desc' }, { queueSeq: 'desc' }],
      take,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: MESSAGE_INCLUDE,
    });
    return rows.map((m) => this.present(m));
  }

  /**
   * Checagem antes do 1º envio a um contato neste número (docs/envio.md#número-sem-whatsapp):
   * mandar para telefone inexistente é sinal de lista comprada. `false` marca o contato e recusa;
   * `null` (provider não sabe) deixa seguir. Quem chama passa a consulta (o provider fica no
   * módulo do WhatsApp, que depende deste).
   */
  private async assertHasWhatsApp(contactId: string, numberId: string, phone: string, check?: PhoneCheck) {
    if (!check) return;
    const anterior = await this.prisma.conversation.findFirst({ where: { contactId, numberId, lastInboundAt: { not: null } }, select: { id: true } });
    if (anterior) return; // já escreveu por este número: existe
    if ((await check(numberId, phone)) === false) {
      await this.prisma.contact.update({ where: { id: contactId }, data: { waInvalidAt: new Date() } });
      throw new BadRequestException({ code: 'contact_no_whatsapp', message: `O número ${phone} não tem WhatsApp.` });
    }
  }

  /** Última mensagem do contato NESTE número, somando as conversas dele aqui — base do envio frio. */
  private async lastInboundOnNumber(c: { contactId: string; numberId: string; lastInboundAt: Date | null }) {
    if (isWarm(c.lastInboundAt)) return c.lastInboundAt;
    const r = await this.prisma.conversation.aggregate({ where: { contactId: c.contactId, numberId: c.numberId }, _max: { lastInboundAt: true } });
    return r._max.lastInboundAt;
  }

  /**
   * Regra do envio frio (cold-send.ts): o contato não escreveu neste número nas últimas 24h.
   * Não oficial → 409 `cold_send_unofficial`. Oficial → a Meta já exige template (checado
   * antes); para o atendente entra também o recurso do plano. Envio do sistema não confere o
   * recurso: campanha e agenda têm os próprios.
   */
  private async assertColdAllowed(c: { tenantId: string; contactId: string; numberId: string; lastInboundAt: Date | null; number: { provider: string } }, author?: Viewer) {
    if (isWarm(await this.lastInboundOnNumber(c))) return;
    if (c.number.provider !== 'meta') throw new ConflictException({ code: 'cold_send_unofficial', message: COLD_UNOFFICIAL_MESSAGE });
    if (!author || author.role === 'super_admin') return;
    const plan = await this.usage.limits(c.tenantId);
    if (!plan?.limits.features?.includes('proactive_messaging')) {
      throw new ForbiddenException({ code: 'feature_proactive', message: `"${PLAN_FEATURE_LABEL.proactive_messaging}" não está incluído no seu plano: falar com quem não escreveu nas últimas 24h depende dele. Faça upgrade em Plano e uso.` });
    }
  }

  /**
   * Envio pelo sistema (fluxos de automação): sem autor humano, não assume a conversa,
   * respeita quota e janela de 24h, passa pela mesma fila.
   */
  async sendAsSystem(conversationId: string, text?: string, media?: { key: string; type: 'image' | 'document' | 'audio' | 'video'; name?: string; voice?: boolean }, interactive?: import('@atendo/shared').InteractiveMenu, opts?: {
    idempotencyKey?: string;
    /** piso desde a entrega da anterior (atraso do Conteúdo) */
    minGapMs?: number;
    /** template aprovado (Meta): dispensa a janela de 24h, conta na quota de templates */
    template?: NonNullable<OutboundMessage['template']>;
    /** envia em conversa encerrada sem reabrir (lembrete): ela continua encerrada até o contato responder */
    allowClosed?: boolean;
    /** dispensa a regra do envio frio — só a Agenda (lembretes e aviso ao profissional), ver cold-send.ts */
    allowCold?: boolean;
  }) {
    const key = opts?.idempotencyKey;
    if (key) {
      // mesmo envio repetido (job reprocessado, lote de campanha refeito): devolve o que já existe
      const dup = await this.byIdempotencyKey(conversationId, key);
      if (dup) return dup;
    }
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { number: true, contact: { select: { optOutAt: true, waInvalidAt: true } } } });
    if (!conv || (conv.status === 'closed' && !opts?.allowClosed)) throw new BadRequestException('Conversa indisponível');
    // descadastro vale para TODO envio automático (docs/envio.md#descadastro); o atendente segue respondendo
    if (conv.contact.optOutAt) throw new BadRequestException({ code: 'contact_opted_out', message: 'O contato pediu para não receber mensagens automáticas.' });
    if (conv.contact.waInvalidAt) throw new BadRequestException({ code: 'contact_no_whatsapp', message: 'Este telefone não tem WhatsApp.' });
    if (conv.number.status !== 'connected') throw new BadRequestException('Número desconectado');
    const template = opts?.template;
    if (template && conv.number.provider !== 'meta') throw new BadRequestException('Template só existe na API oficial (Meta).');
    if (conv.number.provider === 'meta' && !template && !inMetaWindow(conv.lastInboundAt)) throw new BadRequestException('Fora da janela de 24h da Meta');
    if (!opts?.allowCold) await this.assertColdAllowed(conv);
    const quota = await this.usage.canSend(conv.tenantId, template ? 'templates' : 'messages');
    if (!quota.ok) throw new ForbiddenException(quota.reason);
    // variações `{Oi|Olá}` sorteadas por envio: robô mandando o texto idêntico a todos é padrão de spam
    if (text) text = spin(text);
    // no histórico do painel a mensagem interativa aparece como texto + opções numeradas
    const shown = interactive?.options.length ? `${text ?? ''}\n\n${interactive.options.map((o, i) => `${i + 1} - ${o.title}`).join('\n')}` : text;
    const created = await this.createOnce(conversationId, key, () => this.prisma.message.create({
      data: { conversationId, numberId: conv.numberId, direction: 'out', type: template ? 'template' : media ? media.type : 'text', status: 'pending', text: shown, mediaUrl: media?.key, mediaName: media?.name, idempotencyKey: key, raw: template ? ({ template } as Prisma.InputJsonValue) : interactive ? ({ interactive, body: text } as unknown as Prisma.InputJsonValue) : media?.voice === false ? { voice: false } : undefined },
    }));
    if (!created.fresh) return created.message;
    const message = created.message;
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastMessagePreview: messagePreview({ type: template ? 'template' : media ? media.type : 'text', text: shown, mediaName: media?.name }).slice(0, 120), awaitingSince: null } });
    await enqueueOutbound(this.outbound, message, { minGapMs: opts?.minGapMs });
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

  /**
   * Manda uma mensagem do sistema para um contato: reaproveita a conversa aberta ou cria uma.
   *
   * `allowClosed` (lembretes): sem conversa aberta, usa a última do contato no número do sistema
   * — ou cria — e envia nela **sem reabrir**. Sem isto a conversa nascia encerrada e o
   * `sendAsSystem` recusava: lembrete para quem não estava em atendimento nunca saía.
   *
   * `outsideWindow`: número Meta e contato fora da janela de 24h → pede o template a quem chamou
   * (recebe o número, porque o template é aprovado por conta). Sem ele, o envio é recusado.
   */
  async sendToContact(tenantId: string, contactId: string, text: string, opts?: { preferredNumberId?: string | null; interactive?: import('@atendo/shared').InteractiveMenu; idempotencyKey?: string; allowClosed?: boolean; allowCold?: boolean; checkPhone?: PhoneCheck; outsideWindow?: (numberId: string) => Promise<Omit<OutboundMessage, 'to'> | null> }) {
    const contact = await this.prisma.contact.findFirstOrThrow({ where: { id: contactId, tenantId } });
    let conv = await this.prisma.conversation.findFirst({ where: { tenantId, contactId, status: { not: 'closed' } }, orderBy: { lastMessageAt: 'desc' }, include: { number: { select: { provider: true } } } });
    if (!conv) {
      const number = await this.systemNumber(tenantId, opts?.preferredNumberId);
      conv = (opts?.allowClosed && (await this.prisma.conversation.findFirst({ where: { tenantId, contactId, numberId: number.id }, orderBy: { lastMessageAt: 'desc' }, include: { number: { select: { provider: true } } } })))
        || (await this.prisma.conversation.create({ data: { tenantId, numberId: number.id, contactId: contact.id, status: 'closed', closedAt: new Date() }, include: { number: { select: { provider: true } } } }));
    }
    await this.assertHasWhatsApp(contact.id, conv.numberId, contact.phone, opts?.checkPhone);
    const send = { idempotencyKey: opts?.idempotencyKey, allowClosed: opts?.allowClosed, allowCold: opts?.allowCold };
    if (conv.number.provider === 'meta' && !inMetaWindow(conv.lastInboundAt) && opts?.outsideWindow) {
      const tpl = await opts.outsideWindow(conv.numberId);
      if (!tpl?.template) throw new BadRequestException('Fora da janela de 24h da Meta e sem template configurado');
      return this.sendAsSystem(conv.id, tpl.text, undefined, undefined, { ...send, template: tpl.template });
    }
    return this.sendAsSystem(conv.id, text, undefined, opts?.interactive, send);
  }

  /** Manda para um telefone qualquer (ex.: WhatsApp do barbeiro). Cria contato/conversa se preciso. */
  async sendToPhone(tenantId: string, phone: string, text: string, opts?: { closeAfter?: boolean; contactName?: string; preferredNumberId?: string | null; idempotencyKey?: string; allowCold?: boolean; checkPhone?: PhoneCheck }) {
    const clean = phone.replace(/\D/g, '');
    const contact = await this.prisma.contact.upsert({ where: { tenantId_phone: { tenantId, phone: clean } }, create: { tenantId, phone: clean, name: opts?.contactName, ...(opts?.contactName && { nameSource: 'manual' as const }) }, update: {} });
    const number = await this.systemNumber(tenantId, opts?.preferredNumberId);
    await this.assertHasWhatsApp(contact.id, number.id, clean, opts?.checkPhone);
    let conv = await this.prisma.conversation.findFirst({ where: { contactId: contact.id, numberId: number.id }, orderBy: { lastMessageAt: 'desc' } });
    if (!conv) conv = await this.prisma.conversation.create({ data: { tenantId, numberId: number.id, contactId: contact.id, status: 'closed', closedAt: new Date() } });
    // conversa fechada: sendAsSystem exige aberta → abre, envia, fecha de novo (não polui a fila)
    if (conv.status === 'closed') await this.prisma.conversation.update({ where: { id: conv.id }, data: { status: 'in_progress' } });
    const m = await this.sendAsSystem(conv.id, text, undefined, undefined, { idempotencyKey: opts?.idempotencyKey, allowCold: opts?.allowCold });
    if (opts?.closeAfter !== false) {
      const fechada = await this.prisma.conversation.update({ where: { id: conv.id }, data: { status: 'closed', closedAt: new Date(), ...BOT_PAUSE_CLEAR } });
      // o envio acima emitiu a conversa aberta; sem este aviso ela ficava em "Em atendimento" até o F5
      this.gateway.emitConversation(fechada.tenantId, fechada);
    }
    return m;
  }

  async setStatusSystem(conversationId: string, status: ConversationStatus) {
    const antes = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { status: true, botPausedAt: true } });
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status,
        closedAt: status === 'closed' ? new Date() : null,
        // encerrar limpa a pausa do robô: o próximo atendimento começa normal
        ...(status === 'closed' && BOT_PAUSE_CLEAR),
        ...(status === 'waiting' && { assigneeId: null }),
        // sair de encerrado começa outro atendimento: o desfecho do anterior fica congelado no
        // histórico, e deixá-lo aqui marcaria o atendimento novo como se já tivesse resultado
        ...(status !== 'closed' && { outcome: 'none' as const, outcomeValue: null, outcomeReason: null, outcomeAt: null, outcomeById: null }),
      },
    });
    // ator nulo: foi o fluxo, não uma pessoa — e a diferença importa na auditoria
    await this.registrar({ tenantId: conv.tenantId, conversationId, type: tipoDaTransicao(antes?.status, status), fromStatus: antes?.status, toStatus: status, reason: 'automação' });
    if (status === 'closed' && antes?.botPausedAt) await this.registrar({ tenantId: conv.tenantId, conversationId, type: 'bot_resumed', reason: BOT_RESUMED_ON_CLOSE });
    if (status === 'closed') await this.encerrarFluxosPausados([conversationId]);
    this.gateway.emitConversation(conv.tenantId, conv);
    return conv;
  }

  /**
   * Envio do atendente. Sai SEMPRE pelo número da conversa, lido do banco — nada no payload escolhe
   * o número, e não há fallback para outro: se o canal não pode enviar, a mensagem não sai.
   * `expectedNumberId` é o canal que a tela mostrava; se a conversa não está mais nele, 409 sem enviar.
   */
  async send(tenantId: string, author: Viewer, conversationId: string, input: Omit<OutboundMessage, 'to'> & { mediaKey?: string; forwarded?: boolean; expectedNumberId?: string; idempotencyKey?: string; simulateTypingChars?: number }) {
    const authorId = author.id;
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { number: true },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    // clique duplo / reenvio do front com a mesma chave: devolve a mensagem que já foi criada,
    // antes de qualquer regra (a primeira já passou por todas)
    const key = input.idempotencyKey;
    if (key) {
      const dup = await this.byIdempotencyKey(conv.id, key);
      if (dup) return this.present(dup);
    }
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
    await this.assertColdAllowed(conv, author);

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
    // {{saudacao}}, {{contact.first_name}}… de resposta rápida / mensagem agendada / digitada.
    // Chave desconhecida fica como foi escrita; encaminhada e template saem intactos.
    if (input.text?.includes('{{') && !input.template && !input.forwarded) {
      const agent = await this.prisma.user.findUnique({ where: { id: authorId }, select: { name: true } });
      const ctx = await this.interpolation.forContact(tenantId, conv.contactId, {}, { agentName: agent?.name });
      input = { ...input, text: interpolate(input.text, ctx, undefined, { keepUnknown: true }) };
    }
    const created = await this.createOnce(conv.id, key, () => this.prisma.message.create({
      data: {
        idempotencyKey: key,
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
        // `simulateTypingChars`: envio do atendente que ninguém digitou (resposta rápida, encaminhada,
        // agendada, só mídia) — o envio mostra "digitando…" por esse tamanho (docs/envio.md#humanização)
        raw: input.template || input.simulateTypingChars !== undefined
          ? ({ ...(input.template && { template: input.template }), ...(input.simulateTypingChars !== undefined && { simulateTypingChars: input.simulateTypingChars }) } as Prisma.InputJsonValue)
          : undefined,
      },
      include: MESSAGE_INCLUDE,
    }));
    if (!created.fresh) return this.present(created.message);
    const message = created.message;

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

    await enqueueOutbound(this.outbound, message);
    this.gateway.emitMessage(tenantId, this.present(message));
    this.gateway.emitConversation(tenantId, updatedConv);
    return this.present(message);
  }

  /**
   * Quem dá para chamar no "Nova conversa": contatos da base (por nome ou telefone) e, em
   * seguida, nomes da agenda do aparelho (`phonebook_entries`, sincronizada da Evolution) que
   * ainda não são contato. Usuário restrito a números/departamentos só vê contato que já falou
   * por eles, e só a agenda dos números que opera — a busca não pode furar o escopo da lista.
   */
  async startCandidates(tenantId: string, viewer: Viewer, q: string) {
    if (q.trim().length < 2) return { contacts: [], phonebook: [] };
    const match = textSearch(q);
    const numeros = numberFilter(viewer);
    const dept = departmentWhere(viewer);
    const contacts = await this.prisma.contact.findMany({
      where: { tenantId, ...match, ...((numeros || dept) && { conversations: { some: { ...(numeros && { numberId: numeros }), ...dept } } }) },
      select: { id: true, name: true, phone: true, avatarUrl: true },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    });
    const agenda = await this.prisma.phonebookEntry.findMany({
      where: { tenantId, ...match, ...(numeros && { numberId: numeros }) },
      select: { phone: true, name: true, numberId: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
    // quem já é contato aparece como contato (com histórico), não como linha da agenda
    const jaContato = new Set((await this.prisma.contact.findMany({ where: { tenantId, phone: { in: agenda.map((a) => a.phone) } }, select: { phone: true } })).map((c) => c.phone));
    const vistos = new Set<string>();
    const phonebook = agenda.filter((a) => !jaContato.has(a.phone) && !vistos.has(a.phone) && vistos.add(a.phone)).slice(0, 8);
    return { contacts: contacts.map((c) => this.presentContact({ contact: c }).contact), phonebook };
  }

  /**
   * Template + valores digitados/configurados → mensagem pronta para `send`/`sendAsSystem`.
   * Os valores aceitam `{{contact.first_name}}`, globais e `vars` (ex.: `{{servico}}` do
   * lembrete); variável que resolve vazia conta como não preenchida (400 com o nome dela).
   */
  async templateMessage(tenantId: string, contactId: string, definition: MessageTemplate, values: { header?: TemplateValues; body?: TemplateValues }, extra?: { agentName?: string | null; vars?: Record<string, string> }): Promise<Omit<OutboundMessage, 'to'>> {
    const ctx = await this.interpolation.forContact(tenantId, contactId, extra?.vars ?? {}, { agentName: extra?.agentName });
    const fill = (v?: TemplateValues) => Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, interpolate(String(x ?? ''), ctx, undefined, { keepUnknown: false })]));
    try {
      const built = buildTemplateSend(definition, { header: fill(values.header), body: fill(values.body) });
      return { type: 'text', text: built.text, template: built.template };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Iniciar conversa pelo painel (disparo ativo): o atendente fala primeiro.
   *
   * Uma conversa por pessoa e número (ver `reopen.ts`): se já existe, é ela que recebe a
   * mensagem — encerrada volta como atendimento novo de quem iniciou. O envio em si é o `send`
   * normal (posse, quota, janela da Meta, ledger, fila com o ritmo do número); as checagens que
   * podem falhar rodam ANTES de criar/reabrir, para um envio recusado não deixar conversa
   * reaberta à toa.
   *
   * Meta: fora da janela de 24h (e contato novo) só sai template. `template.definition` vem do
   * controller já conferido na Meta; os valores podem ter `{{contact.first_name}}` etc.
   */
  async start(
    tenantId: string,
    author: Viewer,
    input: {
      numberId: string;
      contactId?: string;
      phone?: string;
      name?: string;
      text?: string;
      template?: { definition: MessageTemplate; header?: TemplateValues; body?: TemplateValues };
      idempotencyKey?: string;
    },
    checkPhone?: PhoneCheck,
  ) {
    if (!canUseNumber(author, input.numberId)) throw new ForbiddenException('Você não opera este número.');
    const number = await this.prisma.whatsAppNumber.findFirst({ where: { id: input.numberId, tenantId, isActive: true } });
    if (!number) throw new NotFoundException('Número não encontrado');
    if (number.status !== 'connected') throw new UnprocessableEntityException(`O número "${number.label}" está desconectado. Conecte-o em Números para enviar.`);
    if (input.template && number.provider !== 'meta') throw new BadRequestException('Template só existe na API oficial (Meta).');
    if (!input.template && !input.text?.trim()) throw new BadRequestException('Escreva a mensagem ou escolha um template.');

    // contato: o escolhido na lista, ou pelo telefone digitado (reaproveita quem já existe)
    let contact = input.contactId ? await this.prisma.contact.findFirst({ where: { id: input.contactId, tenantId } }) : null;
    if (input.contactId && !contact) throw new NotFoundException('Contato não encontrado');
    if (!contact) {
      const phone = (input.phone ?? '').replace(/\D/g, '');
      if (phone.length < 10 || phone.length > 15) throw new BadRequestException('Telefone inválido. Use DDI + DDD + número (ex.: 5562999998888).');
      contact = (await this.prisma.contact.findFirst({ where: { tenantId, phone: { in: phoneVariants(phone) } } }))
        ?? (await this.prisma.contact.upsert({
          where: { tenantId_phone: { tenantId, phone } },
          create: { tenantId, phone, name: input.name?.trim() || null, ...(input.name?.trim() && { nameSource: 'manual' as const }) },
          update: {},
        }));
    }

    let conv = await this.prisma.conversation.findFirst({ where: { tenantId, contactId: contact.id, numberId: number.id }, orderBy: { lastMessageAt: 'desc' } });
    // conversa existente num departamento que esta pessoa não vê: não pode virar porta dos fundos
    if (conv && !canSeeDepartment(author, conv.departmentId)) {
      throw new ConflictException({ code: 'other_department', message: 'Este contato já é atendido por um departamento que você não acessa neste número.' });
    }
    if (conv && conv.status !== 'closed' && conv.assigneeId && conv.assigneeId !== author.id) {
      const owner = await this.prisma.user.findUnique({ where: { id: conv.assigneeId }, select: { name: true } });
      throw new ConflictException({ code: 'already_assigned', conversationId: conv.id, message: `${owner?.name ?? 'Outro atendente'} já está atendendo este contato neste número.` });
    }
    if (number.provider === 'meta' && !input.template) {
      const inWindow = conv?.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < META_WINDOW_MS;
      if (!inWindow) throw new BadRequestException('Na API oficial só dá para falar primeiro com template aprovado (o contato não escreveu nas últimas 24h).');
    }
    // telefone sem WhatsApp: diz isso (e não "contato frio"), antes de criar/reabrir
    await this.assertHasWhatsApp(contact.id, number.id, contact.phone, checkPhone);
    // envio frio antes de criar/reabrir: recusado não pode deixar conversa reaberta à toa
    await this.assertColdAllowed({ tenantId, contactId: contact.id, numberId: number.id, lastInboundAt: conv?.lastInboundAt ?? null, number }, author);
    const quota = await this.usage.canSend(tenantId, input.template ? 'templates' : 'messages');
    if (!quota.ok) throw new ForbiddenException(quota.reason);

    // template: variáveis do painel ({{contact.first_name}}…) resolvidas antes de ir para a Meta
    const agentName = input.template ? (await this.prisma.user.findUnique({ where: { id: author.id }, select: { name: true } }))?.name : undefined;
    const message: Omit<OutboundMessage, 'to'> = input.template
      ? await this.templateMessage(tenantId, contact.id, input.template.definition, input.template, { agentName })
      : { type: 'text', text: input.text };

    if (!conv) {
      // nasce na fila sem dono: o `send` faz "responder = assumir" e põe em atendimento
      conv = await this.prisma.conversation.create({ data: { tenantId, numberId: number.id, contactId: contact.id, status: 'waiting', lastMessageAt: new Date() } });
    } else if (conv.status === 'closed') {
      conv = await this.setStatus(tenantId, conv.id, 'in_progress', author.id);
    }
    const sent = await this.send(tenantId, author, conv.id, { ...message, idempotencyKey: input.idempotencyKey });
    return { conversationId: conv.id, message: sent };
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
    const src = await this.prisma.message.findFirst({ where: { id: messageId, conversationId, internal: false, deletedAt: null, conversation: { tenantId } } });
    if (!src) throw new NotFoundException('Mensagem não encontrada');
    const input = this.forwardInput(tenantId, src);

    // o ConversationScopeGuard só olha `:id` (a origem); os destinos vêm no corpo e o recorte
    // por número fica aqui — conversa fora do escopo responde igual a inexistente
    const escopo = numberFilter(author);
    const deptEscopo = departmentWhere(author);
    const pedidos = [...new Set(targetIds)].filter((id) => id !== conversationId).slice(0, FORWARD_MAX_TARGETS);
    const visiveis = await this.prisma.conversation.findMany({ where: { id: { in: pedidos }, tenantId, ...(escopo && { numberId: escopo }), ...deptEscopo }, select: { id: true } });
    const ok = new Set(visiveis.map((v) => v.id));

    const sent: ReturnType<ConversationsService['present']>[] = [];
    const failed: { conversationId: string; error: string }[] = [];
    for (const id of pedidos) {
      if (!ok.has(id)) { failed.push({ conversationId: id, error: 'Conversa não encontrada' }); continue; }
      try {
        // encaminhar não é digitar: "digitando…" simulado pelo tamanho do texto
        sent.push(await this.send(tenantId, author, id, { ...input, simulateTypingChars: (input.text ?? '').length }));
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

  /**
   * "Tentar novamente" numa mensagem com falha: volta para `pending` no FIM da fila da conversa
   * (`queueSeq` novo) e o prazo de expiração recomeça. A troca de status é condicional —
   * clique duplo não enfileira duas vezes. Sai pelo número da conversa; se a conversa mudou de
   * canal desde a falha, 409 em vez de mandar pelo número antigo.
   */
  async resend(tenantId: string, messageId: string) {
    const m = await this.prisma.message.findFirst({ where: { id: messageId, direction: 'out', status: 'failed', internal: false, deletedAt: null, conversation: { tenantId } }, include: { conversation: { include: { number: true } } } });
    if (!m) throw new NotFoundException('Mensagem não encontrada ou não está com falha');
    if (m.numberId && m.numberId !== m.conversation.numberId) {
      throw new ConflictException({ code: 'number_changed', message: `O canal desta conversa mudou para "${m.conversation.number.label}". Envie a mensagem de novo.` });
    }
    if (m.conversation.number.status !== 'connected') throw new BadRequestException(`O número "${m.conversation.number.label}" está desconectado.`);
    const r = await this.prisma.message.updateMany({ where: { id: m.id, status: 'failed' }, data: { status: 'pending', error: null } });
    if (r.count === 0) throw new ConflictException('Esta mensagem já foi reenviada.');
    const queueSeq = await requeueSeq(this.prisma, m.id);
    await enqueueOutbound(this.outbound, { id: m.id, queueSeq: queueSeq ?? m.queueSeq });
    const updated = await this.prisma.message.findUniqueOrThrow({ where: { id: m.id }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(tenantId, this.present(updated));
    return this.present(updated);
  }

  private byIdempotencyKey(conversationId: string, key: string) {
    return this.prisma.message.findUnique({ where: { conversationId_idempotencyKey: { conversationId, idempotencyKey: key } }, include: MESSAGE_INCLUDE });
  }

  /**
   * Cria a mensagem; se outra requisição com a mesma chave criou no mesmo instante (unique de
   * `conversationId + idempotencyKey`), devolve a dela em vez de duplicar.
   */
  private async createOnce<M>(conversationId: string, key: string | undefined, create: () => Promise<M>): Promise<{ fresh: true; message: M } | { fresh: false; message: Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }> }> {
    try {
      return { fresh: true, message: await create() };
    } catch (err) {
      if (!key || !(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      const dup = await this.byIdempotencyKey(conversationId, key);
      if (!dup) throw err;
      return { fresh: false, message: dup };
    }
  }

  /**
   * Confere se o atendente pode reagir a esta mensagem e devolve o que o provider precisa.
   * Mesmas regras de responder (conversa aberta, número conectado, janela da Meta, conversa
   * de outra pessoa não), mas sem assumir a conversa: reagir não é atender.
   */
  async reactionTarget(tenantId: string, author: Viewer, conversationId: string, messageId: string) {
    const m = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, internal: false, deletedAt: null, conversation: { tenantId } },
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

  // ---------- apagar (docs/apagar-mensagens.md) ----------

  /**
   * Quem pode apagar e como. Quem enviou apaga a PRÓPRIA mensagem (ou nota) dentro da janela;
   * o resto — do colega, do robô, recebida, antiga — exige `conversations.delete_message`.
   * Nunca lança por causa do provider: o que não dá para apagar no WhatsApp vira `notice`.
   */
  async deletionPlan(tenantId: string, actor: Viewer, conversationId: string, messageId: string): Promise<DeletionPlan> {
    const m = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, conversation: { tenantId } },
      select: {
        id: true, direction: true, internal: true, authorId: true, status: true, externalId: true, createdAt: true, deletedAt: true,
        number: { select: { id: true, status: true } },
        conversation: { select: { number: { select: { id: true, status: true } }, contact: { select: { phone: true } } } },
      },
    });
    if (!m) throw new NotFoundException('Mensagem não encontrada');
    if (m.deletedAt) throw new ConflictException('Essa mensagem já foi apagada.');
    const age = Date.now() - m.createdAt.getTime();
    if (!may(actor, 'conversations.delete_message')) {
      if (m.direction !== 'out' || m.authorId !== actor.id) throw new ForbiddenException('Seu perfil de acesso só permite apagar as suas próprias mensagens.');
      if (age > OWN_MESSAGE_DELETE_WINDOW_MS) throw new ForbiddenException('Passou o prazo para apagar esta mensagem. Peça a um gerente.');
    }
    const plan: DeletionPlan = { messageId: m.id, conversationId, cancelPending: false, revoke: null, notice: null };
    if (m.internal) return plan;
    if (m.direction === 'in') return { ...plan, notice: DELETE_NOTICE.inbound };
    if (m.status === 'pending') return { ...plan, cancelPending: true };
    // falhou / nunca chegou ao WhatsApp: não há o que apagar no celular do contato
    if (!m.externalId || m.status === 'failed') return plan;
    if (age > MESSAGE_REVOKE_WINDOW_MS) return { ...plan, notice: DELETE_NOTICE.expired };
    // sai pelo número que enviou, não pelo atual da conversa
    const number = m.number ?? m.conversation.number;
    if (number.status !== 'connected') return { ...plan, notice: DELETE_NOTICE.offline };
    return { ...plan, revoke: { numberId: number.id, to: m.conversation.contact.phone, externalId: m.externalId } };
  }

  /**
   * Grava a exclusão, o evento de auditoria e avisa o painel. A linha nunca sai do banco: é o
   * ledger de uso (`MessageUsage`) e o registro do que foi dito.
   */
  async markDeleted(tenantId: string, actor: Viewer & { name: string }, plan: DeletionPlan, outcome: { forEveryone: boolean; notice: string | null }) {
    let notice = outcome.notice;
    const mark = { deletedAt: new Date(), deletedById: actor.id, deletedByName: actor.name, deletedForEveryone: outcome.forEveryone };
    const cancelled = await this.prisma.$transaction(async (tx) => {
      let cancelled = false;
      if (plan.cancelPending) {
        // só cancela o que ainda está na fila: se o worker já entregou, ela chegou ao contato
        const c = await tx.message.updateMany({ where: { id: plan.messageId, status: 'pending', deletedAt: null }, data: { ...mark, status: 'failed', error: CANCELED_SEND } });
        cancelled = c.count > 0;
        if (!cancelled) notice = DELETE_NOTICE.alreadySent;
      }
      if (!cancelled) {
        const r = await tx.message.updateMany({ where: { id: plan.messageId, deletedAt: null }, data: mark });
        if (!r.count) throw new ConflictException('Essa mensagem já foi apagada.');
      }
      const m = await tx.message.findUniqueOrThrow({ where: { id: plan.messageId }, select: { internal: true, direction: true, authorId: true, externalId: true, deletedForEveryone: true } });
      await this.registrar({ tenantId, conversationId: plan.conversationId, type: 'message_deleted', actorId: actor.id, reason: motivoDaExclusao(m, cancelled) }, tx);
      return cancelled;
    });
    // a da frente da fila saiu: chama a próxima da conversa
    if (cancelled) await promoteNext(this.prisma, this.outbound, plan.conversationId).catch(() => undefined);
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: plan.messageId }, include: MESSAGE_INCLUDE });
    const presented = this.present(message);
    this.gateway.emitMessage(tenantId, presented);
    await this.refreshAfterDeletion(tenantId, plan.conversationId);
    return { message: presented, forEveryone: outcome.forEveryone, notice };
  }

  /**
   * O que fazer para editar uma mensagem (docs/editar-mensagens.md). Mesma divisão do apagar: o
   * service decide, o controller fala com o provider, `markEdited` grava.
   *
   * Qualquer mensagem de texto que SAIU pelo número — do próprio atendente, de colega, digitada
   * no celular ou da automação —, para quem tem `conversations.edit_message`. Uma permissão só,
   * de propósito: quem pode editar edita de qualquer origem. Ainda na fila
   * (`pending`) edita só aqui — o worker manda o texto novo. Já enviada: precisa do provider
   * (Evolution; a Meta não edita) e do prazo do WhatsApp (15 min).
   */
  async editPlan(tenantId: string, actor: Viewer, conversationId: string, messageId: string, text: string) {
    if (!may(actor, 'conversations.edit_message')) throw new ForbiddenException('Seu perfil de acesso não permite editar mensagens.');
    const novo = text.trim();
    if (!novo) throw new BadRequestException('A mensagem não pode ficar vazia. Para tirar, apague.');
    const m = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, conversation: { tenantId } },
      select: {
        id: true, direction: true, internal: true, authorId: true, status: true, externalId: true, createdAt: true, deletedAt: true, type: true, text: true, raw: true, content: true,
        author: { select: { name: true } },
        number: { select: { id: true, status: true, provider: true } },
        conversation: { select: { number: { select: { id: true, status: true, provider: true } }, contact: { select: { phone: true } } } },
      },
    });
    if (!m) throw new NotFoundException('Mensagem não encontrada');
    if (m.deletedAt) throw new ConflictException('Essa mensagem foi apagada.');
    if (m.internal) throw new BadRequestException('Nota interna não se edita: apague e escreva de novo.');
    if (m.direction !== 'out') throw new ForbiddenException('Só dá para editar mensagens enviadas pelo número, não as recebidas.');
    const raw = (m.raw ?? {}) as { template?: unknown; interactive?: unknown; key?: { fromMe?: boolean } };
    if (m.type !== 'text' || raw.template || raw.interactive || m.content) throw new BadRequestException('Só mensagens de texto podem ser editadas.');
    if (m.text === novo) throw new BadRequestException('O texto não mudou.');
    // de quem era a mensagem — vai para a auditoria junto com o texto anterior
    const origem = m.authorId ? (m.authorId === actor.id ? 'própria' : `de ${m.author?.name ?? 'outro atendente'}`) : raw.key?.fromMe ? 'enviada pelo celular' : 'da automação';
    const base = { messageId: m.id, conversationId, before: m.text ?? '', origem };
    if (m.status === 'pending') return { ...base, provider: null };
    if (m.status === 'failed' || !m.externalId) throw new ConflictException('Essa mensagem não foi entregue. Apague e envie de novo.');
    if (Date.now() - m.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MS) throw new ConflictException('Passou o prazo do WhatsApp para editar (15 minutos depois do envio).');
    // sai pelo número que enviou, não pelo atual da conversa
    const number = m.number ?? m.conversation.number;
    if (number.provider === 'meta') throw new UnprocessableEntityException('A API oficial da Meta não permite editar mensagens enviadas.');
    if (number.status !== 'connected') throw new UnprocessableEntityException('O número está desconectado: não dá para editar no WhatsApp do contato agora.');
    return { ...base, provider: { numberId: number.id, to: m.conversation.contact.phone, externalId: m.externalId } };
  }

  /**
   * Grava o texto novo, o evento de auditoria (com o texto anterior) e avisa o painel.
   * Ainda na fila: só troca se continuar `pending` — se o worker entregou no meio tempo, o
   * contato recebeu o texto antigo e a tela precisa tentar de novo (agora pelo provider).
   */
  async markEdited(tenantId: string, actor: Viewer, plan: { messageId: string; conversationId: string; before: string; origem: string; provider: unknown }, text: string) {
    const novo = text.trim();
    const r = await this.prisma.message.updateMany({ where: { id: plan.messageId, deletedAt: null, ...(!plan.provider && { status: 'pending' }) }, data: { text: novo, editedAt: new Date() } });
    if (!r.count) throw new ConflictException('A mensagem acabou de ser enviada. Tente editar de novo.');
    await this.registrar({ tenantId, conversationId: plan.conversationId, type: 'message_edited', actorId: actor.id, reason: `Mensagem ${plan.origem}. Antes: "${plan.before.slice(0, 300)}${plan.before.length > 300 ? '…' : ''}"` });
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: plan.messageId }, include: MESSAGE_INCLUDE });
    // era a última da conversa: a prévia da lista mostra o texto novo
    const ultima = await this.prisma.message.findFirst({ where: { conversationId: plan.conversationId, internal: false, deletedAt: null }, orderBy: [{ createdAt: 'desc' }, { queueSeq: 'desc' }], select: { id: true } });
    if (ultima?.id === message.id) {
      const conv = await this.prisma.conversation.update({ where: { id: plan.conversationId }, data: { lastMessagePreview: messagePreview({ type: message.type, text: novo }).slice(0, 120) } });
      this.gateway.emitConversation(tenantId, conv);
    }
    const presented = this.present(message);
    this.gateway.emitMessage(tenantId, presented);
    return presented;
  }

  /** Conteúdo original de uma apagada. A rota exige `conversations.view_deleted`. */
  async deletedOriginal(tenantId: string, conversationId: string, messageId: string): Promise<DeletedMessageOriginal> {
    const m = await this.prisma.message.findFirst({ where: { id: messageId, conversationId, deletedAt: { not: null }, conversation: { tenantId } } });
    if (!m?.deletedAt) throw new NotFoundException('Mensagem apagada não encontrada');
    return {
      id: m.id,
      type: m.type,
      text: m.text,
      mediaUrl: m.mediaUrl && !m.mediaUrl.startsWith('http') ? this.storage.signedUrl(m.mediaUrl) : m.mediaUrl,
      mediaMime: m.mediaMime,
      mediaName: m.mediaName,
      content: m.content as unknown as MessageContent | null,
      deletedAt: m.deletedAt.toISOString(),
      deletedByName: m.deletedByName,
      deletedForEveryone: m.deletedForEveryone,
    };
  }

  /**
   * Limpar o histórico: apaga todas as mensagens da conversa **só no painel** (pedir ao provider
   * uma a uma seria uma rajada de chamadas no número — risco de bloqueio). O que estava na fila
   * é cancelado. A conversa continua existindo: é a linha do tempo com a pessoa, e se ela
   * escrever de novo a conversa segue de onde está.
   */
  async clearHistory(tenantId: string, actor: Viewer & { name: string }, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { id: true } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const mark = { deletedAt: new Date(), deletedById: actor.id, deletedByName: actor.name, deletedForEveryone: false };
    const r = await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.message.updateMany({ where: { conversationId, deletedAt: null, status: 'pending', direction: 'out', internal: false }, data: { ...mark, status: 'failed', error: CANCELED_SEND } });
      const rest = await tx.message.updateMany({ where: { conversationId, deletedAt: null }, data: mark });
      const total = cancelled.count + rest.count;
      if (!total) throw new BadRequestException('Não há mensagens para apagar nesta conversa.');
      const reason = `${total} ${total === 1 ? 'mensagem apagada' : 'mensagens apagadas'} só no painel${cancelled.count ? ` · ${cancelled.count} ${cancelled.count === 1 ? 'envio cancelado' : 'envios cancelados'}` : ''}`;
      await this.registrar({ tenantId, conversationId, type: 'history_cleared', actorId: actor.id, reason }, tx);
      return { cleared: total, cancelled: cancelled.count };
    });
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessagePreview: '🚫 Histórico apagado', summaryCache: null, summaryLastMessageId: null, summaryUpdatedAt: null },
    });
    this.gateway.emitConversation(tenantId, updated);
    this.gateway.emitMessagesCleared(tenantId, conversationId);
    return r;
  }

  /** Prévia do card e resumo da IA não podem continuar mostrando o que foi apagado. */
  private async refreshAfterDeletion(tenantId: string, conversationId: string) {
    const last = await this.prisma.message.findFirst({ where: { conversationId, internal: false }, orderBy: { createdAt: 'desc' }, select: { deletedAt: true } });
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { summaryCache: null, summaryLastMessageId: null, summaryUpdatedAt: null, ...(last?.deletedAt && { lastMessagePreview: DELETED_MESSAGE_LABEL }) },
    });
    this.gateway.emitConversation(tenantId, conv);
  }

  /**
   * Nota interna ("cadeado"): admin/gerente orienta o atendente dentro da conversa.
   * Fica no histórico com destaque, só a equipe vê, nunca vai ao WhatsApp, não conta no uso.
   */
  async note(tenantId: string, author: Viewer & { name: string }, conversationId: string, text: string) {
    if (!may(author, 'conversations.internal_note')) throw new ForbiddenException('Seu perfil de acesso não permite escrever notas internas.');
    const body = text.trim();
    if (!body) throw new BadRequestException('A nota está vazia.');
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const message = await this.prisma.message.create({
      data: { conversationId: conv.id, direction: 'out', type: 'text', status: 'delivered', text: body, authorId: author.id, authorName: author.name, internal: true },
      include: MESSAGE_INCLUDE,
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
  async updateContact(tenantId: string, contactId: string, input: { name?: string; email?: string; address?: string; note1?: string; note2?: string; resubscribe?: true }) {
    const { resubscribe, ...data } = input;
    const limpo = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v?.trim()]),
    );
    // contato inexistente (ou de outro cliente) é 404, não erro interno
    // nome digitado na ficha manda; apagado, volta a aceitar o do WhatsApp. Só conta se mudou:
    // a ficha manda o nome junto mesmo quando a pessoa só mexeu no e-mail
    if ('name' in limpo) {
      const atual = await this.prisma.contact.findFirst({ where: { id: contactId, tenantId }, select: { name: true } });
      if (atual && atual.name === limpo.name) delete limpo.name;
      else (limpo as Record<string, unknown>).nameSource = limpo.name ? 'manual' : 'whatsapp';
    }
    // descadastro só sai por pedido explícito (o contato pediu ao atendente para voltar a receber)
    if (resubscribe) limpo.optOutAt = null;
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
    outcome?: { outcome: ConversationOutcome; value?: number; reason?: string; products?: string; items?: { description?: string; value: number }[]; notes?: string },
  ) {
    // venda em lista: o total é a soma dos itens, calculada aqui — não confia na conta do front
    // item só com valor (sem descrição) vale; linha vazia é descartada
    const itens = outcome?.outcome === 'won' ? outcome.items?.map((i) => ({ description: i.description?.trim() ?? '', value: Math.round(i.value * 100) / 100 })).filter((i) => i.description || i.value > 0) : undefined;
    if (itens?.length) {
      const total = Math.round(itens.reduce((a, i) => a + i.value * 100, 0)) / 100;
      const descricoes = itens.map((i) => i.description).filter(Boolean);
      outcome = { ...outcome!, value: total > 0 ? total : undefined, products: descricoes.length ? descricoes.join('; ').slice(0, 500) : outcome!.products };
    }
    // o desfecho só faz sentido ao encerrar; reabrir limpa, porque o atendimento continua
    const desfecho =
      status !== 'closed'
        ? { outcome: 'none' as const, outcomeValue: null, outcomeReason: null, outcomeAt: null, outcomeById: null }
        : outcome && outcome.outcome !== 'none'
          ? {
              outcome: outcome.outcome,
              outcomeValue: outcome.outcome === 'won' && outcome.value ? new Prisma.Decimal(outcome.value) : null,
              outcomeReason: outcome.outcome === 'lost' ? (outcome.reason?.trim() || null) : null,
              outcomeAt: new Date(),
              outcomeById: userId,
            }
          : {};

    const antes = await this.prisma.conversation.findFirst({ where: { id, tenantId }, select: { status: true, botPausedAt: true } });
    const conv = await this.prisma.conversation.update({
      where: { id, tenantId },
      data: {
        status,
        closedAt: status === 'closed' ? new Date() : null,
        // encerrar limpa a pausa do robô: o próximo atendimento começa normal
        ...(status === 'closed' && BOT_PAUSE_CLEAR),
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
    // venda: linha própria e imutável — é a base de conversão, ticket médio e desempenho por atendente
    if (status === 'closed' && outcome?.outcome === 'won' && conv.outcomeValue) {
      const vendedor = (await this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { id: true } }))?.id ?? null;
      await this.prisma.sale.create({
        data: {
          tenantId,
          conversationId: id,
          contactId: conv.contactId,
          userId: vendedor,
          amount: conv.outcomeValue,
          products: outcome.products?.trim() || null,
          items: itens?.length ? itens : undefined,
          notes: outcome.notes?.trim() || null,
          closedAt: conv.closedAt ?? new Date(),
        },
      });
    }
    if (status === 'closed' && antes?.botPausedAt) await this.registrar({ tenantId, conversationId: id, type: 'bot_resumed', reason: BOT_RESUMED_ON_CLOSE });
    if (status === 'closed') await this.encerrarFluxosPausados([id]);
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
        // departamento e posse usam OR: cada um no seu item do AND para não se sobrescreverem
        AND: [departmentWhere(viewer) ?? {}, may(viewer, 'conversations.view_all') ? {} : { OR: [{ assigneeId: viewer.id }, { assigneeId: null }] }],
      },
      select: { id: true, status: true, botPausedAt: true },
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
        ...BOT_PAUSE_CLEAR,
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
    const pausadas = alvos.filter((a) => a.botPausedAt);
    if (pausadas.length) {
      await this.prisma.conversationEvent.createMany({
        data: pausadas.map((a) => ({ tenantId, conversationId: a.id, type: 'bot_resumed' as const, reason: BOT_RESUMED_ON_CLOSE })),
      });
    }

    await this.encerrarFluxosPausados(idsAlvo);
    // cada conversa precisa ir pelo socket: quem está com o painel aberto vê a fila esvaziar
    const fechadas = await this.prisma.conversation.findMany({ where: { id: { in: idsAlvo } } });
    for (const c of fechadas) this.gateway.emitConversation(tenantId, c);
    this.log.log(`${fechadas.length} atendimento(s) encerrados em massa por ${viewer.id}`);
    return { closed: fechadas.length, ignored: pedidos.length - fechadas.length };
  }

  // ---------- robô pausado na conversa ----------

  /**
   * Encerrar o atendimento libera a pausa — e o fluxo congelado nela não pode ficar pendurado
   * esperando um "continuar" que não vai vir. (Run rodando/esperando é encerrado pelo próprio
   * motor no próximo passo, que vê a conversa fechada.)
   */
  private async encerrarFluxosPausados(conversationIds: string[]) {
    const r = await this.prisma.flowRun.updateMany({
      where: { conversationId: { in: conversationIds }, status: 'paused' },
      data: { status: 'stopped', endedAt: new Date(), error: 'conversa encerrada', pausedFrom: null },
    });
    if (r.count) await this.prisma.conversation.updateMany({ where: { id: { in: conversationIds } }, data: { activeFlowRunId: null } });
  }

  /**
   * Grava a pausa (quem parou o fluxo em andamento e agenda o fim é o `FlowEngineService.pauseBot`).
   * Pausar de novo com a pausa ativa troca a duração e conta a partir de agora.
   */
  async setBotPause(tenantId: string, id: string, by: { id: string }, minutes: number | null) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, tenantId }, select: { status: true } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.status === 'closed') throw new BadRequestException('Conversa encerrada: não há fluxo para pausar.');
    // mesma regra do `registrar`: dono do sistema não tem linha em `users` deste tenant
    const actorId = (await this.prisma.user.findFirst({ where: { id: by.id, tenantId }, select: { id: true } }))?.id ?? null;
    const now = new Date();
    const until = minutes ? new Date(now.getTime() + minutes * 60_000) : null;
    const updated = await this.prisma.conversation.update({ where: { id }, data: { botPausedAt: now, botPausedById: actorId, botPausedUntil: until } });
    // duração (e não o horário) no texto: o histórico não sabe o fuso de quem lê
    await this.registrar({ tenantId, conversationId: id, type: 'bot_paused', actorId, reason: minutes ? `por ${minutes % 60 ? `${minutes} min` : `${minutes / 60} h`}` : 'até retomar manualmente' });
    this.gateway.emitConversation(tenantId, updated);
    return updated;
  }

  /**
   * Retoma o robô. `by` nulo = fim automático do tempo. `pausedAt` (job do fim automático):
   * só retoma se a pausa ainda é a mesma — pausar de novo deixa o job antigo sem efeito.
   * Não retoma a execução interrompida: a próxima mensagem do contato segue as regras de entrada.
   */
  async clearBotPause(tenantId: string, id: string, by: { id: string } | null, pausedAt?: Date) {
    const r = await this.prisma.conversation.updateMany({
      where: { id, tenantId, ...(pausedAt ? { botPausedAt: pausedAt } : { botPausedAt: { not: null } }) },
      data: BOT_PAUSE_CLEAR,
    });
    const conv = await this.prisma.conversation.findFirst({ where: { id, tenantId } });
    if (!conv) {
      // job do fim automático de conversa que foi apagada: nada a fazer
      if (!by) return null;
      throw new NotFoundException('Conversa não encontrada');
    }
    if (r.count === 0) return conv;
    await this.registrar({ tenantId, conversationId: id, type: 'bot_resumed', actorId: by?.id, reason: by ? null : 'fim do tempo de pausa' });
    this.gateway.emitConversation(tenantId, conv);
    return conv;
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
  }, db: Prisma.TransactionClient = this.prisma) {
    // super_admin não tem linha em `users` deste tenant: entra como sistema, senão a FK quebra
    const actorId = e.actorId && (await db.user.findFirst({ where: { id: e.actorId, tenantId: e.tenantId }, select: { id: true } })) ? e.actorId : null;
    await db.conversationEvent.create({ data: { ...e, actorId } });
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
const BOT_RESUMED_ON_CLOSE = 'atendimento encerrado';

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

/** Texto do histórico: "Vendas → Suporte", "Sem departamento → Vendas". */
export function departmentChangeReason(from?: string | null, to?: string | null) {
  return `${from ?? 'Sem departamento'} → ${to ?? 'Sem departamento'}`;
}

/**
 * Texto do evento de auditoria. Diz O QUE foi apagado e ONDE, nunca o conteúdo: o histórico do
 * atendimento é aberto a quem vê a conversa, e o original é só para `conversations.view_deleted`.
 */
function motivoDaExclusao(m: { internal: boolean; direction: MessageDirection; authorId: string | null; externalId: string | null; deletedForEveryone: boolean }, cancelled: boolean) {
  if (m.internal) return 'Nota interna';
  if (m.direction === 'in') return 'Mensagem recebida do contato · apagada só no painel';
  const quem = m.authorId ? 'Mensagem enviada pela equipe' : 'Mensagem enviada pela automação';
  if (cancelled) return `${quem} · envio cancelado antes de sair`;
  if (m.deletedForEveryone) return `${quem} · apagada também no WhatsApp do contato`;
  return m.externalId ? `${quem} · apagada só no painel (continua no WhatsApp do contato)` : `${quem} · não tinha chegado ao contato`;
}

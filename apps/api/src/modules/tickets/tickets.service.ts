/** Regras dos tickets (docs/tickets.md). Fora do tickets.module.ts: o motor de fluxos usa o serviço, e importar o módulo fechava o ciclo Fluxos → Tickets → Conversas → Fluxos. */
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import {
  DEFAULT_TICKET_HOLD_REASONS, TICKET_ACTIVE_STATUSES, TICKET_CONTEXT_SIZE, messagePreview, type MessageContent, type TicketContextMessage, TICKET_MAX_PARTICIPANTS, TICKET_PRIORITIES, TICKET_STATUS_LABEL, TICKET_STATUSES, TICKET_TEXT_MAX, TICKET_TITLE_MAX,
  type Permission, type TicketEventType, type TicketPriority, type TicketStatus,
  TICKET_SOURCES, TICKET_SOURCE_LABEL, TICKET_TYPE_PRESETS, checkTicketValues, cleanTicketFields, type TicketField, type TicketSource, type TicketType,
} from '@atendo/shared';
import { UsageService } from '../billing/usage.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { ConversationsService } from '../conversations/conversations.service';
import { canUseNumber } from '../auth/number-scope';
import { canSeeDepartment } from '../auth/department-scope';

const NULLABLE = (_: unknown, v: unknown) => v !== null;

export class CreateTicketDto {
  @IsString() @MinLength(3) @MaxLength(TICKET_TITLE_MAX) title: string;
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) description?: string;
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() responsibleId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(TICKET_MAX_PARTICIPANTS) @IsUUID('4', { each: true }) participantIds?: string[];
  @IsOptional() @IsUUID() conversationId?: string;
  /** mensagem da conversa de onde o ticket nasce (o "momento"); sem ela, a última */
  @IsOptional() @IsUUID() messageId?: string;
  @IsOptional() @IsDateString() dueAt?: string;
  /** tipo (docs/tickets.md#tipos-de-ticket): setor/prioridade/prazo vazios vêm dele */
  @IsOptional() @IsUUID() typeId?: string;
  /** valores dos campos do tipo, por chave */
  @IsOptional() @IsObject() fields?: Record<string, unknown>;
}
export class TypeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @Matches(/^#[0-9a-f]{6}$/i) color?: string;
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() departmentId?: string | null;
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @IsOptional() @ValidateIf(NULLABLE) @IsInt() @Min(1) @Max(365) dueDays?: number | null;
  @IsOptional() @IsArray() fields?: unknown[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class PresetDto {
  @IsIn(TICKET_TYPE_PRESETS.map((p) => p.niche)) niche: string;
}
export class UpdateTicketDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(TICKET_TITLE_MAX) title?: string;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(TICKET_TEXT_MAX) description?: string | null;
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @IsOptional() @ValidateIf(NULLABLE) @IsDateString() dueAt?: string | null;
  @IsOptional() @IsObject() fields?: Record<string, unknown>;
}
export class CommentDto {
  @IsString() @MinLength(1) @MaxLength(TICKET_TEXT_MAX) body: string;
}
export class StatusDto {
  @IsIn(['open', 'in_progress', 'resolved', 'canceled']) status: Exclude<TicketStatus, 'on_hold'>;
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) note?: string;
}
export class HoldDto {
  @IsUUID() reasonId: string;
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) note?: string;
  /** quando retomar (aviso de espera vencida); opcional */
  @IsOptional() @IsDateString() until?: string;
}
export class NoteDto {
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) note?: string;
}
export class TransferDto {
  /** novo setor; null = sem setor */
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() departmentId?: string | null;
  /** novo responsável; null = ninguém (o setor assume) */
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() responsibleId?: string | null;
  /** quem transferiu continua como participante */
  @IsOptional() @IsBoolean() keepMe?: boolean;
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) note?: string;
}
export class ParticipantDto {
  @IsUUID() userId: string;
  @IsOptional() @IsIn(['responsible', 'participant']) role?: 'responsible' | 'participant';
}
export class HoldReasonDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class ListDto {
  /** mine = sou responsável ou participante · department = dos meus setores · created = abri · all = tudo que posso ver */
  @IsOptional() @IsIn(['mine', 'department', 'created', 'all']) scope?: 'mine' | 'department' | 'created' | 'all';
  /** status; `active` = aberto + em andamento + em espera */
  @IsOptional() @IsIn([...TICKET_STATUSES, 'active']) status?: TicketStatus | 'active';
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsUUID() typeId?: string;
  @IsOptional() @IsIn(TICKET_SOURCES) source?: TicketSource;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

const PAGE = 50;
/** fim do dia (Brasília) daqui a N dias — prazo vale o dia inteiro, como no formulário */
const endOfDayIn = (days: number) => {
  const ymd = new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${ymd}T23:59:00-03:00`);
};
const has = (u: AuthUser, p: Permission) => u.role === 'super_admin' || !!u.permissions?.includes(p);
const pessoa = { select: { id: true, name: true } } as const;
const LIST_INCLUDE = {
  department: { select: { id: true, name: true, color: true } },
  holdReason: { select: { id: true, name: true } },
  type: { select: { id: true, name: true, color: true, fields: true } },
  createdBy: pessoa,
  participants: { include: { user: pessoa }, orderBy: { addedAt: 'asc' } },
  _count: { select: { events: { where: { type: 'comment' } } } },
} satisfies Prisma.TicketInclude;
type TicketRow = Prisma.TicketGetPayload<{ include: typeof LIST_INCLUDE }>;

/**
 * Tickets internos (docs/tickets.md). Quem vê: quem abriu, quem atua (responsável/participantes),
 * quem atende o setor de destino (`tickets.handle`; sem setor na equipe = todos) e quem tem
 * `tickets.view_all`/`tickets.manage`. Quem atua: participantes, quem atende o setor e a gestão.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    // forwardRef: Fluxos → Tickets → Conversas → Fluxos (o bloco "Abrir ticket")
    @Inject(forwardRef(() => ConversationsGateway)) private readonly gateway: ConversationsGateway,
    @Inject(forwardRef(() => ConversationsService)) private readonly conversations: ConversationsService,
    private readonly usage: UsageService,
  ) {}

  /** Setores que a pessoa atende; null = todos (sem setor na equipe). */
  private setores(u: AuthUser): string[] | null {
    return u.departmentIds?.length ? [...u.departmentIds] : null;
  }

  private visible(u: AuthUser): Prisma.TicketWhereInput {
    if (has(u, 'tickets.view_all') || has(u, 'tickets.manage')) return { tenantId: u.tenantId };
    const ou: Prisma.TicketWhereInput[] = [{ createdById: u.id }, { participants: { some: { userId: u.id } } }];
    if (has(u, 'tickets.handle')) {
      const s = this.setores(u);
      ou.push(s ? { departmentId: { in: s } } : { departmentId: { not: null } });
    }
    return { tenantId: u.tenantId, OR: ou };
  }

  private canAct(u: AuthUser, t: { departmentId: string | null; participants: { userId: string }[] }) {
    if (has(u, 'tickets.manage')) return true;
    if (t.participants.some((p) => p.userId === u.id)) return true;
    if (!has(u, 'tickets.handle')) return false;
    const s = this.setores(u);
    return !!t.departmentId && (!s || s.includes(t.departmentId));
  }

  private async load(u: AuthUser, id: string) {
    const t = await this.prisma.ticket.findFirst({ where: { id, AND: [this.visible(u)] }, include: LIST_INCLUDE });
    if (!t) throw new NotFoundException('Ticket não encontrado');
    return t;
  }

  private async loadForAction(u: AuthUser, id: string) {
    const t = await this.load(u, id);
    if (!this.canAct(u, t)) throw new ForbiddenException('Você pode ver este ticket, mas não atua nele. Peça para ser incluído.');
    return t;
  }

  private present(u: AuthUser, t: TicketRow) {
    const responsible = t.participants.find((p) => p.role === 'responsible');
    return {
      id: t.id, number: t.number, title: t.title, description: t.description, status: t.status as TicketStatus, priority: t.priority as TicketPriority,
      department: t.department, conversationId: t.conversationId, createdBy: t.createdBy, createdAt: t.createdAt, updatedAt: t.updatedAt,
      dueAt: t.dueAt, resolvedAt: t.resolvedAt,
      hold: t.status === 'on_hold' ? { reason: t.holdReason, note: t.holdNote, until: t.holdUntil, since: t.holdSince } : null,
      responsible: responsible?.user ?? null,
      participants: t.participants.map((p) => ({ ...p.user, role: p.role, addedAt: p.addedAt })),
      comments: t._count.events,
      canAct: this.canAct(u, t),
      type: t.type ? { id: t.type.id, name: t.type.name, color: t.type.color } : null,
      // definição atual dos campos (rótulos) + o que foi preenchido; campo removido do tipo continua aparecendo pelo valor
      typeFields: (t.type?.fields as unknown as TicketField[] | undefined) ?? [],
      fields: (t.fields as Record<string, string> | null) ?? {},
      source: (TICKET_SOURCES as readonly string[]).includes(t.source) ? (t.source as TicketSource) : 'panel',
    };
  }

  /** Pessoas ativas da equipe (para responsável/participantes). */
  private async assertUsers(tenantId: string, ids: string[]) {
    if (!ids.length) return;
    const n = await this.prisma.user.count({ where: { tenantId, id: { in: ids }, isActive: true } });
    if (n !== new Set(ids).size) throw new BadRequestException('Pessoa não encontrada na equipe (ou desativada).');
  }

  private async assertDepartment(tenantId: string, id: string | null | undefined) {
    if (!id) return;
    if (!(await this.prisma.department.findFirst({ where: { id, tenantId }, select: { id: true } }))) throw new BadRequestException('Setor não encontrado');
  }

  private event(tx: Prisma.TransactionClient, t: { id: string; tenantId: string }, actorId: string | null, type: TicketEventType, body?: string | null, data?: Prisma.InputJsonValue) {
    return tx.ticketEvent.create({ data: { ticketId: t.id, tenantId: t.tenantId, type, actorId, body: body?.trim() || null, ...(data !== undefined && { data }) } });
  }

  /** Avisa as telas (lista) e, em destaque, quem passou a atuar. */
  private notify(tenantId: string, t: { id: string; number: number; title: string }, alertUserIds: string[] = [], alert?: string) {
    this.gateway.emitTicket(tenantId, { id: t.id }, alertUserIds, alert ? { id: t.id, number: t.number, title: t.title, message: alert } : undefined);
  }

  // ---------- leitura ----------

  async list(u: AuthUser, q: ListDto) {
    const and: Prisma.TicketWhereInput[] = [this.visible(u)];
    const scope = q.scope ?? 'all';
    if (scope === 'mine') and.push({ participants: { some: { userId: u.id } } });
    if (scope === 'created') and.push({ createdById: u.id });
    if (scope === 'department') {
      const s = this.setores(u);
      and.push(s ? { departmentId: { in: s } } : { departmentId: { not: null } });
    }
    if (q.status === 'active') and.push({ status: { in: TICKET_ACTIVE_STATUSES } });
    else if (q.status) and.push({ status: q.status });
    if (q.priority) and.push({ priority: q.priority });
    if (q.departmentId) and.push({ departmentId: q.departmentId === 'none' ? null : q.departmentId });
    if (q.typeId) and.push({ typeId: q.typeId });
    if (q.source) and.push({ source: q.source });
    const termo = q.search?.trim();
    if (termo) {
      const n = Number(termo.replace(/^#/, ''));
      and.push({ OR: [{ title: { contains: termo, mode: 'insensitive' } }, { description: { contains: termo, mode: 'insensitive' } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])] });
    }
    const where: Prisma.TicketWhereInput = { AND: and };
    const page = q.page ?? 1;
    const [rows, total] = await Promise.all([
      this.prisma.ticket.findMany({ where, include: LIST_INCLUDE, orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * PAGE, take: PAGE }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items: rows.map((t) => this.present(u, t)), total, page, pageSize: PAGE };
  }

  /** Contagens do menu e das abas. */
  async summary(u: AuthUser) {
    const base = this.visible(u);
    const ativos = { status: { in: TICKET_ACTIVE_STATUSES } };
    const s = this.setores(u);
    const agora = new Date();
    // "para pegar": aberto, sem responsável, num setor que eu atendo (ou sem setor, para a gestão)
    const paraPegar: Prisma.TicketWhereInput = has(u, 'tickets.manage') ? {} : has(u, 'tickets.handle') ? (s ? { departmentId: { in: s } } : { departmentId: { not: null } }) : { id: '-' };
    const [mine, department, onHold, holdExpired, overdue, toPick] = await Promise.all([
      this.prisma.ticket.count({ where: { AND: [base, ativos, { participants: { some: { userId: u.id } } }] } }),
      has(u, 'tickets.handle') ? this.prisma.ticket.count({ where: { AND: [base, ativos, s ? { departmentId: { in: s } } : { departmentId: { not: null } }] } }) : 0,
      this.prisma.ticket.count({ where: { AND: [base, { status: 'on_hold' }] } }),
      this.prisma.ticket.count({ where: { AND: [base, { status: 'on_hold', holdUntil: { lt: agora } }] } }),
      this.prisma.ticket.count({ where: { AND: [base, { status: { in: ['open', 'in_progress'] }, dueAt: { lt: agora } }] } }),
      this.prisma.ticket.count({ where: { AND: [base, paraPegar, { status: 'open' }] } }),
    ]);
    return { mine, department, onHold, holdExpired, overdue, toPick };
  }

  async get(u: AuthUser, id: string) {
    const t = await this.load(u, id);
    const events = await this.prisma.ticketEvent.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' }, include: { actor: pessoa } });
    const conversa = t.conversationId
      ? await this.prisma.conversation.findUnique({ where: { id: t.conversationId }, select: { id: true, numberId: true, departmentId: true, contact: { select: { name: true, phone: true } } } })
      : null;
    return {
      ...this.present(u, t),
      messageId: t.messageId,
      context: (t.context as TicketContextMessage[] | null) ?? null,
      // o link "Ver na conversa" só para quem pode abrir a conversa; o retrato vale para todos do ticket
      conversation: conversa && { id: conversa.id, contact: conversa.contact, canOpen: canUseNumber(u, conversa.numberId) && canSeeDepartment(u, conversa.departmentId) },
      events: events.map((e) => ({ id: e.id, type: e.type, body: e.body, data: e.data, actor: e.actor, createdAt: e.createdAt })),
    };
  }

  /** Tickets ligados a uma conversa (selo no topo da conversa) — só os que a pessoa enxerga. */
  async byConversation(u: AuthUser, conversationId: string) {
    await this.assertConversation(u, conversationId);
    const rows = await this.prisma.ticket.findMany({
      where: { conversationId, AND: [this.visible(u)] },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, number: true, title: true, status: true, messageId: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, status: r.status as TicketStatus }));
  }

  /** A conversa existe no cliente e a pessoa pode abri-la (mesmo critério do painel: número e setor). */
  private async assertConversation(u: AuthUser, conversationId: string) {
    const c = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId: u.tenantId }, select: { id: true, numberId: true, departmentId: true } });
    if (!c || !canUseNumber(u, c.numberId) || !canSeeDepartment(u, c.departmentId)) throw new BadRequestException('Atendimento não encontrado');
    return c;
  }

  /**
   * Retrato das últimas mensagens até `messageId` (ou até agora). Guardado no ticket para o
   * contexto não depender da conversa continuar existindo nem de quem atende o ticket vê-la.
   */
  private async snapshot(conversationId: string, messageId?: string): Promise<{ anchorId: string | null; context: TicketContextMessage[] }> {
    const anchor = messageId ? await this.prisma.message.findFirst({ where: { id: messageId, conversationId }, select: { id: true, createdAt: true } }) : null;
    if (messageId && !anchor) throw new BadRequestException('Mensagem não encontrada nesta conversa');
    const rows = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null, type: { not: 'call' }, ...(anchor && { createdAt: { lte: anchor.createdAt } }) },
      orderBy: { createdAt: 'desc' },
      take: TICKET_CONTEXT_SIZE,
      select: { id: true, createdAt: true, direction: true, internal: true, type: true, text: true, content: true, mediaName: true, authorName: true, senderName: true, author: { select: { name: true } } },
    });
    const anchorId = anchor?.id ?? rows[0]?.id ?? null;
    const context = rows.reverse().map((m) => ({
      id: m.id,
      at: m.createdAt.toISOString(),
      from: m.internal ? ('note' as const) : m.direction === 'in' ? ('in' as const) : ('out' as const),
      author: m.direction === 'in' ? m.senderName : (m.author?.name ?? m.authorName ?? null),
      text: messagePreview({ type: m.type, text: m.text, content: m.content as MessageContent | null, mediaName: m.mediaName }).slice(0, 1000),
      ...(m.id === anchorId && { anchor: true }),
    }));
    return { anchorId, context };
  }

  /** Marco na conversa (nota interna): nunca derruba a ação do ticket. */
  private markConversation(t: { id: string; number: number; conversationId: string | null }, text: string, content: Extract<MessageContent, { kind: 'ticket' }>) {
    if (!t.conversationId) return;
    void this.conversations.systemNote(t.conversationId, text, content).catch(() => undefined);
  }

  /** O que o formulário precisa: equipe ativa, setores (com quem está em cada) e motivos de espera. */
  async options(u: AuthUser) {
    await this.seedHoldReasons(u.tenantId);
    const [users, departments, holdReasons, types] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId: u.tenantId, isActive: true }, select: { id: true, name: true, departments: { select: { departmentId: true } } }, orderBy: { name: 'asc' } }),
      this.prisma.department.findMany({ where: { tenantId: u.tenantId, isActive: true }, select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } }),
      this.prisma.ticketHoldReason.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
      this.listTypes(u.tenantId),
    ]);
    return {
      users: users.map((x) => ({ id: x.id, name: x.name, departmentIds: x.departments.map((d) => d.departmentId) })),
      departments,
      holdReasons: holdReasons.map((r) => ({ id: r.id, name: r.name, isActive: r.isActive })),
      types,
    };
  }

  // ---------- escrita ----------

  async create(u: AuthUser, dto: CreateTicketDto) {
    await this.assertDepartment(u.tenantId, dto.departmentId);
    const participantes = [...new Set((dto.participantIds ?? []).filter((id) => id !== dto.responsibleId))];
    await this.assertUsers(u.tenantId, [...(dto.responsibleId ? [dto.responsibleId] : []), ...participantes]);
    if (dto.messageId && !dto.conversationId) throw new BadRequestException('Informe a conversa da mensagem');
    if (dto.conversationId) await this.assertConversation(u, dto.conversationId);
    const tipo = dto.typeId ? await this.typeOf(u.tenantId, dto.typeId) : null;
    const campos = tipo ? checkTicketValues(tipo.fields, dto.fields) : null;
    if (campos?.missing.length) throw new BadRequestException(`Preencha: ${campos.missing.join(', ')}.`);
    if (campos?.invalid.length) throw new BadRequestException(`Confira: ${campos.invalid.join(', ')}.`);
    const t = await this.insert(u.tenantId, {
      title: dto.title, description: dto.description, priority: dto.priority, departmentId: dto.departmentId, responsibleId: dto.responsibleId, participantIds: participantes,
      conversationId: dto.conversationId, messageId: dto.messageId, dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined, type: tipo, fields: campos?.values,
      source: dto.conversationId ? 'conversation' : 'panel', actorId: u.id, actorName: u.name,
    });
    return this.get(u, t.id);
  }

  /**
   * Ticket aberto pela automação (docs/tickets.md#pelo-fluxo): bloco "Abrir ticket" do fluxo (e, depois,
   * o agente de IA). Sem pessoa por trás: não confere permissão de quem abre, só o plano. Campo
   * obrigatório vazio ou opção fora da lista NÃO impede — o ticket abre e `warnings` volta para o
   * fluxo avisar a equipe (perder a solicitação do contato é pior que um campo em branco).
   */
  async createSystem(tenantId: string, input: {
    title: string; description?: string; priority?: TicketPriority; departmentId?: string | null; responsibleId?: string | null;
    conversationId: string; typeId?: string | null; fields?: Record<string, string>; dueDays?: number | null; source: Extract<TicketSource, 'flow' | 'agent'>; originName: string;
  }): Promise<{ id: string; number: number; warnings: string[] }> {
    const plano = await this.usage.limits(tenantId);
    if (!plano?.limits.features?.includes('tickets')) throw new BadRequestException('Tickets internos não estão no plano desta empresa.');
    const warnings: string[] = [];
    const tipo = input.typeId ? await this.typeOf(tenantId, input.typeId).catch(() => null) : null;
    if (input.typeId && !tipo) warnings.push('o tipo de ticket escolhido não existe mais: abriu sem tipo');
    let departmentId = input.departmentId ?? null;
    if (departmentId && !(await this.prisma.department.findFirst({ where: { id: departmentId, tenantId, isActive: true }, select: { id: true } }))) {
      warnings.push('o setor escolhido não existe mais ou está desativado: abriu no setor do tipo');
      departmentId = null;
    }
    let responsibleId = input.responsibleId ?? null;
    if (responsibleId && !(await this.prisma.user.findFirst({ where: { id: responsibleId, tenantId, isActive: true }, select: { id: true } }))) {
      warnings.push('o responsável escolhido não está mais na equipe: abriu sem responsável (o setor assume)');
      responsibleId = null;
    }
    const campos = tipo ? checkTicketValues(tipo.fields, input.fields) : null;
    if (campos?.missing.length) warnings.push(`campos obrigatórios vazios no ticket: ${campos.missing.join(', ')}`);
    if (campos?.invalid.length) warnings.push(`campos com valor fora do esperado: ${campos.invalid.join(', ')}`);
    const dueDays = input.dueDays ?? tipo?.dueDays ?? null;
    const t = await this.insert(tenantId, {
      title: input.title.trim().slice(0, TICKET_TITLE_MAX) || tipo?.name || 'Solicitação', description: input.description?.slice(0, TICKET_TEXT_MAX), priority: input.priority,
      departmentId, responsibleId: responsibleId ?? undefined, participantIds: [], conversationId: input.conversationId,
      dueAt: dueDays ? endOfDayIn(dueDays) : undefined, type: tipo, fields: campos?.values, source: input.source, actorId: null, actorName: input.originName,
    });
    return { id: t.id, number: t.number, warnings };
  }

  /**
   * Grava o ticket (número sequencial com nova tentativa na colisão), a linha do tempo, os avisos e o
   * marco na conversa. Setor/prioridade/prazo que não vieram saem do tipo.
   */
  private async insert(tenantId: string, i: {
    title: string; description?: string; priority?: TicketPriority; departmentId?: string | null; responsibleId?: string; participantIds: string[];
    conversationId?: string; messageId?: string; dueAt?: Date; type: TicketType | null; fields?: Record<string, string>; source: TicketSource; actorId: string | null; actorName: string;
  }) {
    const departmentId = i.departmentId || i.type?.departmentId || null;
    const priority = i.priority ?? i.type?.priority ?? 'normal';
    const dueAt = i.dueAt ?? (i.type?.dueDays ? endOfDayIn(i.type.dueDays) : null);
    const snap = i.conversationId ? await this.snapshot(i.conversationId, i.messageId) : null;
    for (let tentativa = 0; ; tentativa++) {
      try {
        const t = await this.prisma.$transaction(async (tx) => {
          const ultimo = await tx.ticket.aggregate({ where: { tenantId }, _max: { number: true } });
          const novo = await tx.ticket.create({
            data: {
              tenantId, number: (ultimo._max.number ?? 0) + 1, title: i.title.trim(), description: i.description?.trim() || null,
              priority, departmentId, conversationId: i.conversationId ?? null, createdById: i.actorId,
              messageId: snap?.anchorId ?? null, ...(snap && snap.context.length ? { context: snap.context as unknown as Prisma.InputJsonValue } : {}),
              dueAt, status: i.responsibleId ? 'in_progress' : 'open', typeId: i.type?.id ?? null, source: i.source,
              ...(i.fields && Object.keys(i.fields).length ? { fields: i.fields } : {}),
              participants: { create: [...(i.responsibleId ? [{ userId: i.responsibleId, role: 'responsible' }] : []), ...i.participantIds.map((userId) => ({ userId, role: 'participant' }))] },
            },
          });
          await this.event(tx, novo, i.actorId, 'created', null, {
            departmentId: novo.departmentId, responsibleId: i.responsibleId ?? null, participantIds: i.participantIds,
            ...(i.actorId ? {} : { source: i.source, origin: i.actorName }),
          });
          return novo;
        });
        await this.alertNew(tenantId, t, [i.responsibleId, ...i.participantIds].filter((x): x is string => !!x && x !== i.actorId), i);
        const quem = i.actorId ? `por ${i.actorName}` : `pelo ${i.source === 'flow' ? 'fluxo' : 'agente'} "${i.actorName}"`;
        this.markConversation(t, `🎫 Ticket #${t.number} aberto ${quem}: ${t.title}`, { kind: 'ticket', ticketId: t.id, number: t.number, event: 'opened', fromMessageId: snap?.anchorId ?? null });
        return t;
      } catch (e) {
        // dois tickets ao mesmo tempo pegaram o mesmo número: tenta de novo
        if (tentativa < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  /**
   * Quem precisa saber na hora: responsável/participantes; sem responsável, quem é do setor (é ele
   * que vai pegar). Ticket da automação sem setor nem responsável avisa a gestão (`tickets.manage`
   * vem do perfil — aqui aproximado por administradores e gerentes ativos).
   */
  private async alertNew(tenantId: string, t: { id: string; number: number; title: string; departmentId: string | null }, pessoas: string[], i: { responsibleId?: string; actorId: string | null; source: TicketSource }) {
    let alvo = pessoas;
    if (!i.responsibleId) {
      const setor = t.departmentId
        ? await this.prisma.user.findMany({ where: { tenantId, isActive: true, departments: { some: { departmentId: t.departmentId } } }, select: { id: true } })
        : !i.actorId ? await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: { in: ['tenant_admin', 'manager'] } }, select: { id: true } }) : [];
      alvo = [...new Set([...pessoas, ...setor.map((x) => x.id)])].filter((x) => x !== i.actorId);
    }
    const origem = i.source === 'flow' || i.source === 'agent' ? ` (${TICKET_SOURCE_LABEL[i.source].toLowerCase()})` : '';
    this.notify(tenantId, t, alvo, i.responsibleId ? `Ticket #${t.number} para você: ${t.title}` : `Novo ticket #${t.number}${origem}: ${t.title}`);
  }

  // ---------- tipos de ticket ----------

  private presentType(r: { id: string; name: string; color: string; departmentId: string | null; priority: string; dueDays: number | null; fields: Prisma.JsonValue; isActive: boolean }): TicketType {
    return { id: r.id, name: r.name, color: r.color, departmentId: r.departmentId, priority: (TICKET_PRIORITIES as readonly string[]).includes(r.priority) ? (r.priority as TicketPriority) : 'normal', dueDays: r.dueDays, fields: cleanTicketFields(r.fields), isActive: r.isActive };
  }

  async listTypes(tenantId: string) {
    const rows = await this.prisma.ticketType.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
    return rows.map((r) => this.presentType(r));
  }

  private async typeOf(tenantId: string, id: string) {
    const r = await this.prisma.ticketType.findFirst({ where: { id, tenantId } });
    if (!r) throw new BadRequestException('Tipo de ticket não encontrado');
    return this.presentType(r);
  }

  async saveType(u: AuthUser, id: string | null, dto: TypeDto) {
    if (dto.departmentId) await this.assertDepartment(u.tenantId, dto.departmentId);
    const data = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.color !== undefined && { color: dto.color }),
      ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.dueDays !== undefined && { dueDays: dto.dueDays }),
      ...(dto.fields !== undefined && { fields: cleanTicketFields(dto.fields) as unknown as Prisma.InputJsonValue }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    try {
      if (id) {
        const { count } = await this.prisma.ticketType.updateMany({ where: { id, tenantId: u.tenantId }, data });
        if (!count) throw new NotFoundException('Tipo não encontrado');
      } else {
        if (!dto.name?.trim()) throw new BadRequestException('Dê um nome ao tipo');
        const n = await this.prisma.ticketType.count({ where: { tenantId: u.tenantId } });
        await this.prisma.ticketType.create({ data: { tenantId: u.tenantId, name: dto.name.trim(), position: n, ...data } });
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Já existe um tipo com esse nome');
      throw e;
    }
    return this.listTypes(u.tenantId);
  }

  /** Apaga se nunca foi usado; com tickets, só desativa (os tickets continuam mostrando o tipo). */
  async deleteType(u: AuthUser, id: string) {
    const usados = await this.prisma.ticket.count({ where: { tenantId: u.tenantId, typeId: id } });
    if (usados) await this.prisma.ticketType.updateMany({ where: { id, tenantId: u.tenantId }, data: { isActive: false } });
    else await this.prisma.ticketType.deleteMany({ where: { id, tenantId: u.tenantId } });
    return this.listTypes(u.tenantId);
  }

  /** Importa os tipos de um nicho (pula os que já existem com o mesmo nome). */
  async applyPreset(u: AuthUser, niche: string) {
    const preset = TICKET_TYPE_PRESETS.find((p) => p.niche === niche);
    if (!preset) throw new BadRequestException('Modelo não encontrado');
    const n = await this.prisma.ticketType.count({ where: { tenantId: u.tenantId } });
    await this.prisma.ticketType.createMany({
      data: preset.types.map((t, i) => ({ tenantId: u.tenantId, name: t.name, color: t.color, priority: t.priority, dueDays: t.dueDays, fields: t.fields as unknown as Prisma.InputJsonValue, position: n + i })),
      skipDuplicates: true,
    });
    return this.listTypes(u.tenantId);
  }

  async update(u: AuthUser, id: string, dto: UpdateTicketDto) {
    const t = await this.loadForAction(u, id);
    const data: Prisma.TicketUpdateInput = {
      ...(dto.title !== undefined && { title: dto.title.trim() }),
      ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
      ...(dto.priority && { priority: dto.priority }),
      ...(dto.dueAt !== undefined && { dueAt: dto.dueAt ? new Date(dto.dueAt) : null }),
    };
    if (dto.fields !== undefined) {
      const tipo = t.type ? await this.typeOf(u.tenantId, t.type.id) : null;
      if (!tipo) throw new BadRequestException('Este ticket não tem tipo com campos.');
      const c = checkTicketValues(tipo.fields, dto.fields);
      if (c.missing.length) throw new BadRequestException(`Preencha: ${c.missing.join(', ')}.`);
      if (c.invalid.length) throw new BadRequestException(`Confira: ${c.invalid.join(', ')}.`);
      data.fields = c.values;
    }
    const mudou = Object.keys(data);
    if (!mudou.length) return this.get(u, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data });
      await this.event(tx, t, u.id, 'edited', null, { fields: mudou, ...(dto.priority && { priority: dto.priority }), ...(dto.dueAt !== undefined && { dueAt: dto.dueAt }) });
    });
    this.notify(u.tenantId, t);
    return this.get(u, id);
  }

  async comment(u: AuthUser, id: string, body: string) {
    const t = await this.load(u, id);
    // quem abriu comenta mesmo sem atuar (responde dúvida, manda informação)
    if (!this.canAct(u, t) && t.createdBy?.id !== u.id) throw new ForbiddenException('Você não atua neste ticket.');
    await this.prisma.$transaction(async (tx) => {
      await this.event(tx, t, u.id, 'comment', body);
      await tx.ticket.update({ where: { id }, data: { updatedAt: new Date() } });
    });
    const avisar = [...t.participants.map((p) => p.userId), ...(t.createdBy ? [t.createdBy.id] : [])].filter((x) => x !== u.id);
    this.notify(u.tenantId, t, [...new Set(avisar)], `Comentário no ticket #${t.number}`);
    return this.get(u, id);
  }

  async setStatus(u: AuthUser, id: string, dto: StatusDto) {
    const t = await this.load(u, id);
    const dono = t.createdBy?.id === u.id;
    // cancelar: gestão ou quem abriu (enquanto ninguém resolveu); o resto, quem atua
    if (dto.status === 'canceled' ? !(has(u, 'tickets.manage') || dono) : !this.canAct(u, t)) throw new ForbiddenException('Você não pode mudar a situação deste ticket.');
    if (t.status === dto.status) return this.get(u, id);
    if (['resolved', 'canceled'].includes(t.status) && dto.status !== 'open' && dto.status !== 'in_progress') throw new BadRequestException('Reabra o ticket antes.');
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: {
          status: dto.status, holdReasonId: null, holdNote: null, holdUntil: null, holdSince: null,
          resolvedAt: dto.status === 'resolved' ? new Date() : dto.status === 'canceled' ? t.resolvedAt : null,
        },
      });
      await this.event(tx, t, u.id, 'status', dto.note, { from: t.status, to: dto.status });
    });
    const avisar = [...t.participants.map((p) => p.userId), ...(t.createdBy ? [t.createdBy.id] : [])].filter((x) => x !== u.id);
    this.notify(u.tenantId, t, [...new Set(avisar)], `Ticket #${t.number}: ${TICKET_STATUS_LABEL[dto.status]}`);
    // a conversa de origem fica sabendo do desfecho: resolvido, cancelado ou reaberto
    const nota = dto.note?.trim() ? `\n${dto.note.trim()}` : '';
    this.markConversation(t, `🎫 Ticket #${t.number} ${TICKET_STATUS_LABEL[dto.status].toLowerCase()} por ${u.name}: ${t.title}${nota}`, { kind: 'ticket', ticketId: t.id, number: t.number, event: 'status', status: dto.status });
    return this.get(u, id);
  }

  /** Congelar: o ticket espera algo de fora (prestador, peça, aprovação). */
  async hold(u: AuthUser, id: string, dto: HoldDto) {
    const t = await this.loadForAction(u, id);
    if (['resolved', 'canceled'].includes(t.status)) throw new BadRequestException('Ticket encerrado não entra em espera.');
    const motivo = await this.prisma.ticketHoldReason.findFirst({ where: { id: dto.reasonId, tenantId: u.tenantId, isActive: true } });
    if (!motivo) throw new BadRequestException('Motivo de espera não encontrado');
    const until = dto.until ? new Date(dto.until) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data: { status: 'on_hold', holdReasonId: motivo.id, holdNote: dto.note?.trim() || null, holdUntil: until, holdSince: new Date() } });
      await this.event(tx, t, u.id, 'hold', dto.note, { reason: motivo.name, until: until?.toISOString() ?? null, from: t.status });
    });
    this.notify(u.tenantId, t, t.participants.map((p) => p.userId).filter((x) => x !== u.id), `Ticket #${t.number} em espera: ${motivo.name}`);
    return this.get(u, id);
  }

  async resume(u: AuthUser, id: string, note?: string) {
    const t = await this.loadForAction(u, id);
    if (t.status !== 'on_hold') throw new BadRequestException('O ticket não está em espera.');
    const proximo = t.participants.some((p) => p.role === 'responsible') ? 'in_progress' : 'open';
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data: { status: proximo, holdReasonId: null, holdNote: null, holdUntil: null, holdSince: null } });
      await this.event(tx, t, u.id, 'resume', note, { reason: t.holdReason?.name ?? null, since: t.holdSince?.toISOString() ?? null });
    });
    this.notify(u.tenantId, t, t.participants.map((p) => p.userId).filter((x) => x !== u.id), `Ticket #${t.number} saiu da espera`);
    return this.get(u, id);
  }

  /** Transferir: outro setor e/ou outro responsável; quem transferiu pode continuar junto. */
  async transfer(u: AuthUser, id: string, dto: TransferDto) {
    const t = await this.loadForAction(u, id);
    if (dto.departmentId === undefined && dto.responsibleId === undefined) throw new BadRequestException('Escolha o setor ou a pessoa.');
    if (dto.departmentId !== undefined) await this.assertDepartment(u.tenantId, dto.departmentId);
    if (dto.responsibleId) await this.assertUsers(u.tenantId, [dto.responsibleId]);
    const antes = t.participants.find((p) => p.role === 'responsible')?.userId ?? null;
    const depto = dto.departmentId !== undefined ? dto.departmentId : t.departmentId;
    const resp = dto.responsibleId !== undefined ? dto.responsibleId : antes;
    await this.prisma.$transaction(async (tx) => {
      // o responsável antigo vira participante (o histórico dele fica); o novo assume
      if (antes && antes !== resp) await tx.ticketParticipant.update({ where: { ticketId_userId: { ticketId: id, userId: antes } }, data: { role: 'participant' } });
      if (resp) await tx.ticketParticipant.upsert({ where: { ticketId_userId: { ticketId: id, userId: resp } }, create: { ticketId: id, userId: resp, role: 'responsible' }, update: { role: 'responsible' } });
      // sair do ticket: quem transferiu (não sendo o novo responsável) e não quis ficar
      if (!dto.keepMe && u.id !== resp) await tx.ticketParticipant.deleteMany({ where: { ticketId: id, userId: u.id } });
      await tx.ticket.update({ where: { id }, data: { departmentId: depto, ...(t.status === 'open' && resp && { status: 'in_progress' }), ...(t.status === 'in_progress' && !resp && { status: 'open' }) } });
      await this.event(tx, t, u.id, 'transfer', dto.note, { fromDepartmentId: t.departmentId, toDepartmentId: depto, fromResponsibleId: antes, toResponsibleId: resp, keepMe: !!dto.keepMe });
    });
    this.notify(u.tenantId, t, resp && resp !== u.id ? [resp] : [], `Ticket #${t.number} transferido para você: ${t.title}`);
    return this.get(u, id);
  }

  async addParticipant(u: AuthUser, id: string, dto: ParticipantDto) {
    const t = await this.loadForAction(u, id);
    await this.assertUsers(u.tenantId, [dto.userId]);
    if (t.participants.length >= TICKET_MAX_PARTICIPANTS && !t.participants.some((p) => p.userId === dto.userId)) throw new BadRequestException(`No máximo ${TICKET_MAX_PARTICIPANTS} pessoas por ticket.`);
    const role = dto.role ?? 'participant';
    await this.prisma.$transaction(async (tx) => {
      if (role === 'responsible') await tx.ticketParticipant.updateMany({ where: { ticketId: id, role: 'responsible' }, data: { role: 'participant' } });
      await tx.ticketParticipant.upsert({ where: { ticketId_userId: { ticketId: id, userId: dto.userId } }, create: { ticketId: id, userId: dto.userId, role }, update: { role } });
      if (role === 'responsible' && t.status === 'open') await tx.ticket.update({ where: { id }, data: { status: 'in_progress' } });
      await this.event(tx, t, u.id, 'participant_added', null, { userId: dto.userId, role });
    });
    this.notify(u.tenantId, t, dto.userId !== u.id ? [dto.userId] : [], `Você foi incluído no ticket #${t.number}: ${t.title}`);
    return this.get(u, id);
  }

  async removeParticipant(u: AuthUser, id: string, userId: string) {
    const t = await this.load(u, id);
    // sair por conta própria sempre pode; tirar outra pessoa, só quem atua
    if (userId !== u.id && !this.canAct(u, t)) throw new ForbiddenException('Você não atua neste ticket.');
    const p = t.participants.find((x) => x.userId === userId);
    if (!p) return this.get(u, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketParticipant.delete({ where: { ticketId_userId: { ticketId: id, userId } } });
      if (p.role === 'responsible' && t.status === 'in_progress') await tx.ticket.update({ where: { id }, data: { status: 'open' } });
      await this.event(tx, t, u.id, 'participant_removed', null, { userId, role: p.role });
    });
    this.notify(u.tenantId, t);
    return userId === u.id && !this.canSeeAfter(u, t) ? { left: true } : this.get(u, id);
  }

  /** Depois de sair do ticket, a pessoa ainda o vê? (abriu, setor ou ver todos) */
  private canSeeAfter(u: AuthUser, t: TicketRow) {
    if (has(u, 'tickets.view_all') || has(u, 'tickets.manage') || t.createdBy?.id === u.id) return true;
    const s = this.setores(u);
    return has(u, 'tickets.handle') && !!t.departmentId && (!s || s.includes(t.departmentId));
  }

  // ---------- motivos de espera ----------

  /** Toda empresa começa com os motivos padrão (uma vez: depois, o que ela editar vale). */
  private async seedHoldReasons(tenantId: string) {
    if (await this.prisma.ticketHoldReason.count({ where: { tenantId } })) return;
    await this.prisma.ticketHoldReason.createMany({ data: DEFAULT_TICKET_HOLD_REASONS.map((name, position) => ({ tenantId, name, position })), skipDuplicates: true });
  }

  async saveHoldReason(u: AuthUser, id: string | null, dto: HoldReasonDto) {
    const data = { name: dto.name.trim(), ...(dto.isActive !== undefined && { isActive: dto.isActive }) };
    try {
      if (id) {
        const r = await this.prisma.ticketHoldReason.updateMany({ where: { id, tenantId: u.tenantId }, data });
        if (!r.count) throw new NotFoundException('Motivo não encontrado');
      } else {
        const fim = await this.prisma.ticketHoldReason.aggregate({ where: { tenantId: u.tenantId }, _max: { position: true } });
        await this.prisma.ticketHoldReason.create({ data: { ...data, tenantId: u.tenantId, position: (fim._max.position ?? -1) + 1 } });
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Já existe um motivo com esse nome.');
      throw e;
    }
    return this.options(u);
  }

  /** Em uso: desativa (o histórico guarda o nome); sem uso: apaga. */
  async deleteHoldReason(u: AuthUser, id: string) {
    const r = await this.prisma.ticketHoldReason.findFirst({ where: { id, tenantId: u.tenantId }, select: { id: true, _count: { select: { tickets: true } } } });
    if (!r) throw new NotFoundException('Motivo não encontrado');
    if (r._count.tickets) await this.prisma.ticketHoldReason.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.ticketHoldReason.delete({ where: { id } });
    return this.options(u);
  }
}


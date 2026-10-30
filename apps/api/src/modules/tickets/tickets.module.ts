import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import {
  DEFAULT_TICKET_HOLD_REASONS, TICKET_ACTIVE_STATUSES, TICKET_MAX_PARTICIPANTS, TICKET_PRIORITIES, TICKET_STATUS_LABEL, TICKET_STATUSES, TICKET_TEXT_MAX, TICKET_TITLE_MAX,
  type Permission, type TicketEventType, type TicketPriority, type TicketStatus,
} from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BillingModule } from '../billing/billing.module';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsGateway } from '../conversations/conversations.gateway';

const NULLABLE = (_: unknown, v: unknown) => v !== null;

class CreateTicketDto {
  @IsString() @MinLength(3) @MaxLength(TICKET_TITLE_MAX) title: string;
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) description?: string;
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() responsibleId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(TICKET_MAX_PARTICIPANTS) @IsUUID('4', { each: true }) participantIds?: string[];
  @IsOptional() @IsUUID() conversationId?: string;
  @IsOptional() @IsDateString() dueAt?: string;
}
class UpdateTicketDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(TICKET_TITLE_MAX) title?: string;
  @IsOptional() @ValidateIf(NULLABLE) @IsString() @MaxLength(TICKET_TEXT_MAX) description?: string | null;
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @IsOptional() @ValidateIf(NULLABLE) @IsDateString() dueAt?: string | null;
}
class CommentDto {
  @IsString() @MinLength(1) @MaxLength(TICKET_TEXT_MAX) body: string;
}
class StatusDto {
  @IsIn(['open', 'in_progress', 'resolved', 'canceled']) status: Exclude<TicketStatus, 'on_hold'>;
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) note?: string;
}
class HoldDto {
  @IsUUID() reasonId: string;
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) note?: string;
  /** quando retomar (aviso de espera vencida); opcional */
  @IsOptional() @IsDateString() until?: string;
}
class NoteDto {
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) note?: string;
}
class TransferDto {
  /** novo setor; null = sem setor */
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() departmentId?: string | null;
  /** novo responsável; null = ninguém (o setor assume) */
  @IsOptional() @ValidateIf(NULLABLE) @IsUUID() responsibleId?: string | null;
  /** quem transferiu continua como participante */
  @IsOptional() @IsBoolean() keepMe?: boolean;
  @IsOptional() @IsString() @MaxLength(TICKET_TEXT_MAX) note?: string;
}
class ParticipantDto {
  @IsUUID() userId: string;
  @IsOptional() @IsIn(['responsible', 'participant']) role?: 'responsible' | 'participant';
}
class HoldReasonDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class ListDto {
  /** mine = sou responsável ou participante · department = dos meus setores · created = abri · all = tudo que posso ver */
  @IsOptional() @IsIn(['mine', 'department', 'created', 'all']) scope?: 'mine' | 'department' | 'created' | 'all';
  /** status; `active` = aberto + em andamento + em espera */
  @IsOptional() @IsIn([...TICKET_STATUSES, 'active']) status?: TicketStatus | 'active';
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

const PAGE = 50;
const has = (u: AuthUser, p: Permission) => u.role === 'super_admin' || !!u.permissions?.includes(p);
const pessoa = { select: { id: true, name: true } } as const;
const LIST_INCLUDE = {
  department: { select: { id: true, name: true, color: true } },
  holdReason: { select: { id: true, name: true } },
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
  constructor(private readonly prisma: PrismaService, private readonly gateway: ConversationsGateway) {}

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

  private event(tx: Prisma.TransactionClient, t: { id: string; tenantId: string }, actorId: string, type: TicketEventType, body?: string | null, data?: Prisma.InputJsonValue) {
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
    const [mine, department, onHold, holdExpired, overdue] = await Promise.all([
      this.prisma.ticket.count({ where: { AND: [base, ativos, { participants: { some: { userId: u.id } } }] } }),
      has(u, 'tickets.handle') ? this.prisma.ticket.count({ where: { AND: [base, ativos, s ? { departmentId: { in: s } } : { departmentId: { not: null } }] } }) : 0,
      this.prisma.ticket.count({ where: { AND: [base, { status: 'on_hold' }] } }),
      this.prisma.ticket.count({ where: { AND: [base, { status: 'on_hold', holdUntil: { lt: agora } }] } }),
      this.prisma.ticket.count({ where: { AND: [base, { status: { in: ['open', 'in_progress'] }, dueAt: { lt: agora } }] } }),
    ]);
    return { mine, department, onHold, holdExpired, overdue };
  }

  async get(u: AuthUser, id: string) {
    const t = await this.load(u, id);
    const events = await this.prisma.ticketEvent.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' }, include: { actor: pessoa } });
    const conversa = t.conversationId
      ? await this.prisma.conversation.findUnique({ where: { id: t.conversationId }, select: { id: true, contact: { select: { name: true, phone: true } } } })
      : null;
    return { ...this.present(u, t), conversation: conversa, events: events.map((e) => ({ id: e.id, type: e.type, body: e.body, data: e.data, actor: e.actor, createdAt: e.createdAt })) };
  }

  /** O que o formulário precisa: equipe ativa, setores (com quem está em cada) e motivos de espera. */
  async options(u: AuthUser) {
    await this.seedHoldReasons(u.tenantId);
    const [users, departments, holdReasons] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId: u.tenantId, isActive: true }, select: { id: true, name: true, departments: { select: { departmentId: true } } }, orderBy: { name: 'asc' } }),
      this.prisma.department.findMany({ where: { tenantId: u.tenantId, isActive: true }, select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } }),
      this.prisma.ticketHoldReason.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
    ]);
    return {
      users: users.map((x) => ({ id: x.id, name: x.name, departmentIds: x.departments.map((d) => d.departmentId) })),
      departments,
      holdReasons: holdReasons.map((r) => ({ id: r.id, name: r.name, isActive: r.isActive })),
    };
  }

  // ---------- escrita ----------

  async create(u: AuthUser, dto: CreateTicketDto) {
    await this.assertDepartment(u.tenantId, dto.departmentId);
    const participantes = [...new Set((dto.participantIds ?? []).filter((id) => id !== dto.responsibleId))];
    await this.assertUsers(u.tenantId, [...(dto.responsibleId ? [dto.responsibleId] : []), ...participantes]);
    if (dto.conversationId && !(await this.prisma.conversation.findFirst({ where: { id: dto.conversationId, tenantId: u.tenantId }, select: { id: true } }))) {
      throw new BadRequestException('Atendimento não encontrado');
    }
    for (let tentativa = 0; ; tentativa++) {
      try {
        const t = await this.prisma.$transaction(async (tx) => {
          const ultimo = await tx.ticket.aggregate({ where: { tenantId: u.tenantId }, _max: { number: true } });
          const novo = await tx.ticket.create({
            data: {
              tenantId: u.tenantId, number: (ultimo._max.number ?? 0) + 1, title: dto.title.trim(), description: dto.description?.trim() || null,
              priority: dto.priority ?? 'normal', departmentId: dto.departmentId ?? null, conversationId: dto.conversationId ?? null, createdById: u.id,
              dueAt: dto.dueAt ? new Date(dto.dueAt) : null, status: dto.responsibleId ? 'in_progress' : 'open',
              participants: { create: [...(dto.responsibleId ? [{ userId: dto.responsibleId, role: 'responsible' }] : []), ...participantes.map((userId) => ({ userId, role: 'participant' }))] },
            },
          });
          await this.event(tx, novo, u.id, 'created', null, { departmentId: novo.departmentId, responsibleId: dto.responsibleId ?? null, participantIds: participantes });
          return novo;
        });
        this.notify(u.tenantId, t, [dto.responsibleId, ...participantes].filter((x): x is string => !!x && x !== u.id), `Ticket #${t.number} para você: ${t.title}`);
        return this.get(u, t.id);
      } catch (e) {
        // dois tickets ao mesmo tempo pegaram o mesmo número: tenta de novo
        if (tentativa < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  async update(u: AuthUser, id: string, dto: UpdateTicketDto) {
    const t = await this.loadForAction(u, id);
    const data: Prisma.TicketUpdateInput = {
      ...(dto.title !== undefined && { title: dto.title.trim() }),
      ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
      ...(dto.priority && { priority: dto.priority }),
      ...(dto.dueAt !== undefined && { dueAt: dto.dueAt ? new Date(dto.dueAt) : null }),
    };
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

@Controller('tickets')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('tickets')
class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListDto) { return this.tickets.list(u, q); }

  @Get('summary')
  summary(@CurrentUser() u: AuthUser) { return this.tickets.summary(u); }

  @Get('options')
  options(@CurrentUser() u: AuthUser) { return this.tickets.options(u); }

  @Post('hold-reasons') @RequirePermission('tickets.manage')
  createReason(@CurrentUser() u: AuthUser, @Body() dto: HoldReasonDto) { return this.tickets.saveHoldReason(u, null, dto); }

  @Patch('hold-reasons/:id') @RequirePermission('tickets.manage')
  updateReason(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HoldReasonDto) { return this.tickets.saveHoldReason(u, id, dto); }

  @Delete('hold-reasons/:id') @RequirePermission('tickets.manage')
  deleteReason(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.tickets.deleteHoldReason(u, id); }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.tickets.get(u, id); }

  @Post() @RequirePermission('tickets.create')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTicketDto) { return this.tickets.create(u, dto); }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) { return this.tickets.update(u, id, dto); }

  @Post(':id/comments')
  comment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto) { return this.tickets.comment(u, id, dto.body); }

  @Post(':id/status')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) { return this.tickets.setStatus(u, id, dto); }

  @Post(':id/hold')
  hold(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HoldDto) { return this.tickets.hold(u, id, dto); }

  @Post(':id/resume')
  resume(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) { return this.tickets.resume(u, id, dto.note); }

  @Post(':id/transfer')
  transfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferDto) { return this.tickets.transfer(u, id, dto); }

  @Post(':id/participants')
  addParticipant(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ParticipantDto) { return this.tickets.addParticipant(u, id, dto); }

  @Delete(':id/participants/:userId')
  removeParticipant(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) { return this.tickets.removeParticipant(u, id, userId); }
}

@Module({ imports: [AuthModule, BillingModule, ConversationsModule], controllers: [TicketsController], providers: [TicketsService] })
export class TicketsModule {}

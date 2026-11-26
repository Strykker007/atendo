import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, OnModuleInit, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import type { AttendanceReview as ReviewRow, Prisma } from '@prisma/client';
import {
  REVIEW_KINDS, resolveReviewSettings,
  type AttendanceReview, type Permission, type ReviewAlertEvent, type ReviewKind, type ReviewSettings, type ReviewStatus,
} from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppLogger } from '../../common/observability/app-logger';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { clip } from '../../common/clip';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService, MESSAGE_INCLUDE } from '../conversations/conversations.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';

/**
 * Feedback de atendimento (docs/feedback-de-atendimento.md).
 *
 * O gestor (`reviews.manage`) aponta algo num atendimento encerrado — correção, oportunidade,
 * orientação, elogio — e o atendente precisa ver e, conforme o tipo, dar ciência. Fica entre os
 * dois: o contato nunca vê, os colegas também não (não é nota interna).
 *
 * "Garantidamente visto" é em camadas: aviso na hora (socket `review_alert`), contador no menu,
 * aviso de novo a cada entrada enquanto houver pendente e, no tipo que trava, não assume outro
 * atendimento sem dar ciência. O prazo conta só o tempo ONLINE do atendente (job abaixo), para
 * folga, escala e ausência não estourarem o prazo.
 */

const QUEUE_REVIEWS = 'attendance-reviews';
const may = (u: AuthUser, p: Permission) => u.role === 'super_admin' || !!u.permissions?.includes(p);

class CreateReviewDto {
  @IsUUID() conversationId: string;
  /** o encerramento (linha da auditoria); ausente = o último encerramento da conversa */
  @IsOptional() @IsUUID() closeEventId?: string;
  /** quem atendeu; ausente = quem encerrou */
  @IsOptional() @IsUUID() agentId?: string;
  @IsIn(REVIEW_KINDS) kind: ReviewKind;
  @IsString() @MinLength(3) @MaxLength(4000) text: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) messageIds?: string[];
}
class AckDto {
  @IsOptional() @IsString() @MaxLength(2000) reply?: string;
}
class KindRuleDto {
  @IsBoolean() requiresAck: boolean;
  @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(200) deadlineHours: number | null;
  @IsBoolean() blocksClaim: boolean;
}
class KindsDto {
  @ValidateNested() @Type(() => KindRuleDto) correction: KindRuleDto;
  @ValidateNested() @Type(() => KindRuleDto) opportunity: KindRuleDto;
  @ValidateNested() @Type(() => KindRuleDto) guidance: KindRuleDto;
  @ValidateNested() @Type(() => KindRuleDto) praise: KindRuleDto;
}
class SettingsDto {
  @ValidateNested() @Type(() => KindsDto) kinds: KindsDto;
  @IsBoolean() notifyReviewerOnOverdue: boolean;
}
class ListQuery {
  @IsOptional() @IsUUID() agentId?: string;
  /** `me` = só os que eu enviei (aba Enviados) */
  @IsOptional() @IsIn(['me']) reviewer?: 'me';
  @IsOptional() @IsIn(REVIEW_KINDS) kind?: ReviewKind;
  /** período do apontamento (ISO); `to` exclusivo */
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  /** nome/telefone do contato ou trecho do texto */
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['pending', 'overdue', 'acknowledged', 'all']) status?: 'pending' | 'overdue' | 'acknowledged' | 'all';
}

type Row = ReviewRow & { conversation: { contact: { name: string | null; phone: string } } };

/** Pendente para o atendente: precisa de ciência e não deu, ou só precisa ver e não viu. */
const pendingWhere = (tenantId: string, agentId: string): Prisma.AttendanceReviewWhereInput => ({
  tenantId, agentId, OR: [{ requiresAck: true, acknowledgedAt: null }, { requiresAck: false, seenAt: null }],
});

function statusOf(r: ReviewRow): ReviewStatus {
  if (r.acknowledgedAt || (!r.requiresAck && r.seenAt)) return 'acknowledged';
  if (r.overdueAt) return 'overdue';
  return r.seenAt ? 'seen' : 'sent';
}

@Injectable()
export class ReviewsService {
  private readonly log = new AppLogger(ReviewsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly gateway: ConversationsGateway,
  ) {}

  async settings(tenantId: string): Promise<ReviewSettings> {
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { reviewSettings: true } });
    return resolveReviewSettings(s?.reviewSettings);
  }

  async saveSettings(tenantId: string, dto: ReviewSettings) {
    const value = resolveReviewSettings(dto);
    // ciência desligada não trava nem tem prazo: as três coisas andam juntas
    for (const k of REVIEW_KINDS) if (!value.kinds[k].requiresAck) value.kinds[k] = { requiresAck: false, deadlineHours: null, blocksClaim: false };
    await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, reviewSettings: value as unknown as Prisma.InputJsonValue },
      update: { reviewSettings: value as unknown as Prisma.InputJsonValue },
    });
    return value;
  }

  private present(r: Row, extra?: { agentLastSeenAt?: Date | null }): AttendanceReview {
    return {
      id: r.id, conversationId: r.conversationId, closeEventId: r.closeEventId,
      windowStart: r.windowStart?.toISOString() ?? null, windowEnd: r.windowEnd?.toISOString() ?? null,
      agent: { id: r.agentId, name: r.agentName }, reviewer: { id: r.reviewerId, name: r.reviewerName },
      kind: r.kind as ReviewKind, text: r.text, messageIds: r.messageIds,
      requiresAck: r.requiresAck, blocksClaim: r.blocksClaim, deadlineMinutes: r.deadlineMinutes, onlineMinutes: r.onlineMinutes,
      seenAt: r.seenAt?.toISOString() ?? null, acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      agentReply: r.agentReply, repliedAt: r.repliedAt?.toISOString() ?? null, overdueAt: r.overdueAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(), status: statusOf(r), contact: r.conversation.contact,
      ...(extra && { agentLastSeenAt: extra.agentLastSeenAt?.toISOString() ?? null }),
    };
  }
  private readonly include = { conversation: { select: { contact: { select: { name: true, phone: true } } } } } as const;

  async create(u: AuthUser, dto: CreateReviewDto) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: dto.conversationId, tenantId: u.tenantId }, select: { id: true, assigneeId: true, contact: { select: { name: true, phone: true } } } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    // o atendimento = o encerramento e a janela desde o encerramento anterior (igual à auditoria)
    const fechamento = dto.closeEventId
      ? await this.prisma.conversationEvent.findFirst({ where: { id: dto.closeEventId, tenantId: u.tenantId, conversationId: conv.id, type: 'closed' } })
      : await this.prisma.conversationEvent.findFirst({ where: { tenantId: u.tenantId, conversationId: conv.id, type: 'closed' }, orderBy: { createdAt: 'desc' } });
    if (dto.closeEventId && !fechamento) throw new NotFoundException('Atendimento não encontrado');
    const anterior = fechamento
      ? await this.prisma.conversationEvent.findFirst({ where: { conversationId: conv.id, type: 'closed', createdAt: { lt: fechamento.createdAt } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
      : null;
    const agentId = dto.agentId ?? fechamento?.actorId ?? conv.assigneeId;
    if (!agentId) throw new BadRequestException('Este atendimento não tem atendente para receber o feedback.');
    if (agentId === u.id) throw new BadRequestException('O feedback é para outra pessoa da equipe, não para você mesmo.');
    const agent = await this.prisma.user.findFirst({ where: { id: agentId, tenantId: u.tenantId }, select: { id: true, name: true } });
    if (!agent) throw new NotFoundException('Atendente não encontrado nesta empresa');
    const regra = (await this.settings(u.tenantId)).kinds[dto.kind];
    const reviewer = await this.prisma.user.findUnique({ where: { id: u.id }, select: { name: true } });

    const r = await this.prisma.attendanceReview.create({
      data: {
        tenantId: u.tenantId, conversationId: conv.id, closeEventId: fechamento?.id ?? null,
        windowStart: anterior?.createdAt ?? null, windowEnd: fechamento?.createdAt ?? null,
        agentId: agent.id, agentName: agent.name, reviewerId: u.id, reviewerName: reviewer?.name ?? 'Gestor',
        kind: dto.kind, text: dto.text.trim(), messageIds: [...new Set(dto.messageIds ?? [])],
        requiresAck: regra.requiresAck, blocksClaim: regra.requiresAck && regra.blocksClaim,
        deadlineMinutes: regra.requiresAck && regra.deadlineHours ? regra.deadlineHours * 60 : null,
      },
      include: this.include,
    });
    this.alert(u.tenantId, agent.id, r, 'new', r.reviewerName);
    return this.present(r);
  }

  private alert(tenantId: string, userId: string | null, r: Row, type: ReviewAlertEvent['type'], byName: string) {
    if (!userId) return;
    this.gateway.emitReviewAlert(tenantId, userId, {
      type, reviewId: r.id, kind: r.kind as ReviewKind, byName,
      contactName: r.conversation.contact.name || r.conversation.contact.phone,
      text: clip(type === 'replied' ? r.agentReply ?? '' : r.text, 160),
    });
  }

  async mine(u: AuthUser) {
    const rows = await this.prisma.attendanceReview.findMany({ where: { tenantId: u.tenantId, agentId: u.id }, orderBy: { createdAt: 'desc' }, take: 200, include: this.include });
    return rows.map((r) => this.present(r));
  }

  async team(u: AuthUser, q: ListQuery) {
    const where: Prisma.AttendanceReviewWhereInput = {
      tenantId: u.tenantId,
      ...(q.agentId && { agentId: q.agentId }),
      ...(q.reviewer === 'me' && { reviewerId: u.id }),
      ...(q.kind && { kind: q.kind }),
      ...((q.from || q.to) && { createdAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lt: new Date(q.to) }) } }),
      ...(q.status === 'pending' && { requiresAck: true, acknowledgedAt: null }),
      ...(q.status === 'overdue' && { acknowledgedAt: null, overdueAt: { not: null } }),
      ...(q.status === 'acknowledged' && { OR: [{ acknowledgedAt: { not: null } }, { requiresAck: false, seenAt: { not: null } }] }),
      // busca num AND: o filtro "cientes" acima já usa OR no mesmo nível
      ...(q.search?.trim() && { AND: [{ OR: [
        { text: { contains: q.search.trim(), mode: 'insensitive' } },
        { agentName: { contains: q.search.trim(), mode: 'insensitive' } },
        { conversation: { contact: { OR: [{ name: { contains: q.search.trim(), mode: 'insensitive' } }, { phone: { contains: q.search.replace(/\D/g, '') || '-' } }] } } },
      ] }] }),
    };
    const rows = await this.prisma.attendanceReview.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, include: this.include });
    const ids = [...new Set(rows.map((r) => r.agentId).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, lastLoginAt: true } });
    const ultimo = new Map(users.map((x) => [x.id, x.lastLoginAt]));
    return rows.map((r) => this.present(r, { agentLastSeenAt: r.agentId ? ultimo.get(r.agentId) ?? null : null }));
  }

  /** Um apontamento: do atendente dele ou de quem tem `reviews.manage`. */
  private async one(u: AuthUser, id: string) {
    const r = await this.prisma.attendanceReview.findFirst({ where: { id, tenantId: u.tenantId }, include: this.include });
    if (!r) throw new NotFoundException('Feedback não encontrado');
    if (r.agentId !== u.id && !may(u, 'reviews.manage')) throw new ForbiddenException('Este feedback é de outra pessoa.');
    return r;
  }

  async get(u: AuthUser, id: string) {
    return this.present(await this.one(u, id));
  }

  /**
   * Mensagens do atendimento apontado (só leitura). Vêm por aqui, e não pela conversa, porque o
   * atendente pode não enxergar mais a conversa (reaberta com outra pessoa, número que ele deixou
   * de operar) — e o feedback é sobre o que ELE fez.
   */
  async messages(u: AuthUser, id: string) {
    const r = await this.one(u, id);
    const rows = await this.prisma.message.findMany({
      where: { conversationId: r.conversationId, createdAt: { ...(r.windowStart && { gt: r.windowStart }), ...(r.windowEnd && { lte: r.windowEnd }) } },
      orderBy: { createdAt: 'asc' }, take: 1000, include: MESSAGE_INCLUDE,
    });
    return rows.map((m) => this.conversations.present(m));
  }

  async seen(u: AuthUser, id: string) {
    const r = await this.one(u, id);
    if (r.agentId !== u.id || r.seenAt) return this.present(r);
    const up = await this.prisma.attendanceReview.update({ where: { id }, data: { seenAt: new Date() }, include: this.include });
    return this.present(up);
  }

  /** "Li e estou ciente", com resposta opcional. Resposta depois da ciência: uma vez só. */
  async ack(u: AuthUser, id: string, reply?: string) {
    const r = await this.one(u, id);
    if (r.agentId !== u.id) throw new ForbiddenException('Só quem recebeu o feedback dá ciência.');
    const texto = reply?.trim() || null;
    if (r.acknowledgedAt && (!texto || r.agentReply)) return this.present(r);
    const agora = new Date();
    const up = await this.prisma.attendanceReview.update({
      where: { id },
      data: { seenAt: r.seenAt ?? agora, acknowledgedAt: r.acknowledgedAt ?? agora, ...(texto && !r.agentReply && { agentReply: texto, repliedAt: agora }) },
      include: this.include,
    });
    this.alert(u.tenantId, up.reviewerId, up, texto && !r.agentReply ? 'replied' : 'acknowledged', up.agentName);
    return this.present(up);
  }

  /** Apagar só antes da ciência (engano no apontamento). Depois vira histórico. */
  async remove(u: AuthUser, id: string) {
    const r = await this.one(u, id);
    if (!may(u, 'reviews.manage')) throw new ForbiddenException();
    if (r.acknowledgedAt) throw new BadRequestException('O atendente já deu ciência: o feedback fica no histórico.');
    await this.prisma.attendanceReview.delete({ where: { id } });
    return { ok: true };
  }

  /** O que o atendente precisa ver ao entrar: feedbacks pendentes e notas internas não lidas. */
  async attention(u: AuthUser) {
    const [pendentes, notes] = await Promise.all([
      this.prisma.attendanceReview.findMany({ where: pendingWhere(u.tenantId, u.id), orderBy: { createdAt: 'desc' }, take: 50, include: this.include }),
      this.conversations.pendingNotes(u.tenantId, u.id),
    ]);
    return {
      reviews: { pending: pendentes.length, blocking: pendentes.filter((r) => r.blocksClaim && !r.acknowledgedAt).length, items: pendentes.slice(0, 5).map((r) => this.present(r)) },
      notes,
    };
  }

  /** Atendimentos (encerramentos) que já têm feedback: a auditoria marca a linha. */
  async byCloseEvents(u: AuthUser, ids: string[]) {
    if (!ids.length) return {};
    const rows = await this.prisma.attendanceReview.groupBy({ by: ['closeEventId'], where: { tenantId: u.tenantId, closeEventId: { in: ids } }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.closeEventId, r._count._all]));
  }

  /**
   * Relógio do prazo, a cada minuto: soma 1 minuto em cada pendente cujo atendente está ONLINE
   * agora (painel aberto e dentro do turno — `onlineUserIds`, o mesmo do Distribuidor). Folga,
   * fim de semana, férias e "não entrou" não contam. Bateu o prazo: marca vencido e avisa o gestor.
   */
  async tick() {
    const pendentes = await this.prisma.attendanceReview.findMany({
      where: { requiresAck: true, acknowledgedAt: null, overdueAt: null, agentId: { not: null } },
      select: { id: true, tenantId: true, agentId: true, deadlineMinutes: true, onlineMinutes: true },
      take: 5000,
    });
    if (!pendentes.length) return;
    const porTenant = new Map<string, typeof pendentes>();
    for (const p of pendentes) porTenant.set(p.tenantId, [...(porTenant.get(p.tenantId) ?? []), p]);
    for (const [tenantId, lista] of porTenant) {
      const online = await this.gateway.onlineUserIds(tenantId).catch(() => new Set<string>());
      const contam = lista.filter((p) => online.has(p.agentId!));
      if (!contam.length) continue;
      await this.prisma.attendanceReview.updateMany({ where: { id: { in: contam.map((p) => p.id) } }, data: { onlineMinutes: { increment: 1 } } });
      const vencidos = contam.filter((p) => p.deadlineMinutes !== null && p.onlineMinutes + 1 >= p.deadlineMinutes);
      if (!vencidos.length) continue;
      await this.prisma.attendanceReview.updateMany({ where: { id: { in: vencidos.map((p) => p.id) }, overdueAt: null }, data: { overdueAt: new Date() } });
      const s = await this.settings(tenantId);
      if (!s.notifyReviewerOnOverdue) continue;
      const rows = await this.prisma.attendanceReview.findMany({ where: { id: { in: vencidos.map((p) => p.id) } }, include: this.include });
      for (const r of rows) this.alert(tenantId, r.reviewerId, r, 'overdue', r.agentName);
      this.log.log(`cliente ${tenantId}: ${rows.length} feedback(s) com prazo vencido`);
    }
  }
}

@Controller('reviews')
@UseGuards(JwtAuthGuard, PermissionsGuard)
class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('settings')
  settings(@CurrentUser() u: AuthUser) {
    return this.reviews.settings(u.tenantId);
  }
  @Patch('settings')
  @RequirePermission('settings.manage')
  saveSettings(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto) {
    return this.reviews.saveSettings(u.tenantId, dto as unknown as ReviewSettings);
  }

  @Get('attention')
  attention(@CurrentUser() u: AuthUser) {
    return this.reviews.attention(u);
  }
  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.reviews.mine(u);
  }
  @Get()
  @RequirePermission('reviews.manage')
  team(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.reviews.team(u, q);
  }
  /** `?ids=a,b,c` (ids de encerramento da auditoria) → { [id]: quantos feedbacks } */
  @Get('by-attendance')
  @RequirePermission('reviews.manage')
  byAttendance(@CurrentUser() u: AuthUser, @Query('ids') ids = '') {
    return this.reviews.byCloseEvents(u, ids.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100));
  }
  @Post()
  @RequirePermission('reviews.manage')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateReviewDto) {
    return this.reviews.create(u, dto);
  }
  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.reviews.get(u, id);
  }
  @Get(':id/messages')
  messages(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.reviews.messages(u, id);
  }
  @Post(':id/seen')
  seen(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.reviews.seen(u, id);
  }
  @Post(':id/ack')
  ack(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AckDto) {
    return this.reviews.ack(u, id, dto.reply);
  }
  @Delete(':id')
  @RequirePermission('reviews.manage')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.reviews.remove(u, id);
  }
}

/** Relógio do prazo a cada minuto. `upsertJobScheduler` é idempotente entre instâncias. */
@Injectable()
class ReviewsScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_REVIEWS) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('reviews-clock', { every: 60_000 }, { name: 'reviews-clock' });
  }
}

@Processor(QUEUE_REVIEWS)
class ReviewsProcessor extends TrackedWorkerHost {
  constructor(private readonly service: ReviewsService) {
    super(QUEUE_REVIEWS);
  }
  protected async handle(_job: Job) {
    await this.service.tick();
  }
}

const queue = BullModule.registerQueue({ name: QUEUE_REVIEWS, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } });

/** API: rotas. O relógio roda no worker (`ReviewsWorkerModule`). */
@Module({ imports: [AuthModule, ConversationsModule], controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}

@Module({ imports: [queue, ConversationsModule], providers: [ReviewsService, ReviewsScheduler, ReviewsProcessor] })
export class ReviewsWorkerModule {}


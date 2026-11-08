import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, OnModuleInit, Param, Post, UseGuards } from '@nestjs/common';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AGENT_PAUSE_MAX_MINUTES, AGENT_PAUSE_REASONS, type AgentPause, type AgentPauseReason, type QueueAgent, type QueueStatus } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppLogger } from '../../common/observability/app-logger';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsGateway, pausedKey } from '../conversations/conversations.gateway';
import { QUEUE_REASON, pauseExpired, pickQueueAgent } from './queue-rules';

export const QUEUE_ATTENDANCE = 'attendance-queue';
/** contatos entregues por rodada e por cliente: o resto sai na próxima (a rodada não trava o worker) */
const BATCH = 100;

/** O que conta para o limite e para a fila: fora grupos e contatos isentos (livres). */
const ATENDIMENTO: Prisma.ConversationWhereInput = { ticketExempt: false, contact: { isGroup: false } };
/** Na fila: Aguardando, sem dono, robô parado. */
const NA_FILA: Prisma.ConversationWhereInput = { ...ATENDIMENTO, status: 'waiting', assigneeId: null, activeFlowRunId: null };

const pauseOf = (p: { reason: string; startedAt: Date; until: Date | null }): AgentPause => ({
  reason: (p.reason in AGENT_PAUSE_REASONS ? p.reason : 'other') as AgentPauseReason,
  startedAt: p.startedAt.toISOString(),
  until: p.until?.toISOString() ?? null,
});

/**
 * Pausa do atendente (docs/fila-de-atendimento.md#pausa). O banco guarda o histórico; o Redis
 * (`presence:paused:<cliente>`) é o que a presença lê — vale para a fila, o bloco Distribuidor e
 * a redistribuição automática ao mesmo tempo.
 */
@Injectable()
export class AgentPauseService {
  private readonly log = new AppLogger(AgentPauseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /** Pausa aberta (e dentro do prazo) da pessoa. */
  async current(tenantId: string, userId: string) {
    const p = await this.prisma.agentPause.findFirst({ where: { tenantId, userId, endedAt: null }, orderBy: { startedAt: 'desc' } });
    return p && !pauseExpired(p.until) ? p : null;
  }

  async pause(tenantId: string, userId: string, reason: AgentPauseReason, minutes: number | null) {
    const now = new Date();
    const until = minutes ? new Date(now.getTime() + minutes * 60_000) : null;
    await this.prisma.$transaction([
      // trocar de pausa (almoço → reunião) fecha a anterior
      this.prisma.agentPause.updateMany({ where: { tenantId, userId, endedAt: null }, data: { endedAt: now, endedById: userId } }),
      this.prisma.agentPause.create({ data: { tenantId, userId, reason, startedAt: now, until } }),
    ]);
    await this.redis.hset(pausedKey(tenantId), userId, String(until?.getTime() ?? 0));
    this.gateway.emitAgentStatus(tenantId, userId);
    return pauseOf({ reason, startedAt: now, until });
  }

  /** Volta da pausa. `byId` = quem encerrou (a própria pessoa ou um gerente). */
  async resume(tenantId: string, userId: string, byId: string) {
    const { count } = await this.prisma.agentPause.updateMany({ where: { tenantId, userId, endedAt: null }, data: { endedAt: new Date(), endedById: byId } });
    await this.redis.hdel(pausedKey(tenantId), userId);
    this.gateway.emitAgentStatus(tenantId, userId);
    return { ended: count > 0 };
  }

  /** Abertas por cliente (para a tela da fila). */
  async openByTenant(tenantId: string) {
    const rows = await this.prisma.agentPause.findMany({ where: { tenantId, endedAt: null } });
    return new Map(rows.filter((p) => !pauseExpired(p.until)).map((p) => [p.userId, pauseOf(p)]));
  }

  /**
   * Fecha as pausas com prazo vencido (a pessoa volta a receber) e reescreve o espelho no Redis a
   * partir do banco — se o Redis perdeu a chave, ninguém fica "disponível" estando em pausa.
   * Devolve os clientes em que alguém voltou (a fila roda de novo neles).
   */
  async sync(now = new Date()) {
    const open = await this.prisma.agentPause.findMany({ where: { endedAt: null } });
    const voltaram = new Set<string>();
    const porCliente = new Map<string, Record<string, string>>();
    for (const p of open) {
      if (pauseExpired(p.until, now)) {
        await this.prisma.agentPause.updateMany({ where: { id: p.id, endedAt: null }, data: { endedAt: p.until } });
        await this.redis.hdel(pausedKey(p.tenantId), p.userId);
        this.gateway.emitAgentStatus(p.tenantId, p.userId);
        voltaram.add(p.tenantId);
        this.log.log(`pausa de ${p.userId} (cliente ${p.tenantId}) venceu: volta a receber`);
        continue;
      }
      const m = porCliente.get(p.tenantId) ?? {};
      m[p.userId] = String(p.until?.getTime() ?? 0);
      porCliente.set(p.tenantId, m);
    }
    for (const [tenantId, campos] of porCliente) await this.redis.hset(pausedKey(tenantId), campos);
    return voltaram;
  }
}

/**
 * Fila de atendimento com distribuição automática (docs/fila-de-atendimento.md). Com a regra
 * ligada no cliente, cada contato em Aguardando vai, por ordem de chegada, para quem está
 * disponível (painel aberto, no turno, fora de pausa), atende o número e o departamento da
 * conversa e está abaixo do limite de atendimentos abertos — o que tem menos, sorteando no
 * empate. Ninguém com vaga = fica na fila até alguém encerrar.
 */
@Injectable()
export class AttendanceQueueService implements OnModuleInit {
  private readonly log = new AppLogger(AttendanceQueueService.name);
  /** clientes com a fila ligada (atualizado a cada rodada): evita job para quem não usa */
  private enabled = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly gateway: ConversationsGateway,
    private readonly pauses: AgentPauseService,
    @InjectQueue(QUEUE_ATTENDANCE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    // entrou contato na fila ou alguém encerrou (abriu vaga): roda já, sem esperar a rodada
    this.gateway.conversationListeners.push((tenantId, c) => {
      if (this.enabled.has(tenantId) && (c.status === 'closed' || (c.status === 'waiting' && !c.assigneeId))) this.kick(tenantId);
    });
    // a API (onde o atendente encerra) não roda o processador: mantém a lista de quem usa a fila sozinha
    const refresh = () => this.prisma.tenantSettings.findMany({ where: { autoDistribute: true }, select: { tenantId: true } })
      .then((rows) => { this.enabled = new Set(rows.map((r) => r.tenantId)); })
      .catch(() => undefined);
    void refresh();
    setInterval(refresh, 30_000).unref();
  }

  /** Agenda uma rodada já para o cliente. Vários pedidos no mesmo segundo viram uma rodada só. */
  kick(tenantId: string) {
    void this.queue.add('tenant', { tenantId }, { jobId: `kick-${tenantId}`, delay: 1000, removeOnComplete: true, removeOnFail: true }).catch(() => undefined);
  }

  /** Rodada de todos: fecha pausas vencidas e distribui onde a fila está ligada. */
  async runDue() {
    await this.pauses.sync().catch((e) => this.log.warn(`pausas: ${e instanceof Error ? e.message : e}`));
    const rows = await this.prisma.tenantSettings.findMany({ where: { autoDistribute: true, tenant: { isActive: true } }, select: { tenantId: true } });
    this.enabled = new Set(rows.map((r) => r.tenantId));
    for (const { tenantId } of rows) {
      await this.runTenant(tenantId).catch((e) => this.log.warn(`fila do cliente ${tenantId} falhou: ${e instanceof Error ? e.message : e}`));
    }
  }

  async runTenant(tenantId: string) {
    const cfg = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { autoDistribute: true, autoDistributeMax: true } });
    if (!cfg?.autoDistribute) { this.enabled.delete(tenantId); return; }
    this.enabled.add(tenantId);
    const fila = await this.prisma.conversation.findMany({
      where: { tenantId, ...NA_FILA },
      // por ordem de chegada: quem espera resposta há mais tempo primeiro
      orderBy: [{ awaitingSince: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: BATCH,
      select: { id: true, contactId: true, numberId: true, departmentId: true },
    });
    if (!fila.length) return;
    // disponível = painel aberto, no turno e fora de pausa
    const online = await this.gateway.availableUserIds(tenantId);
    if (!online.size) return;
    const agents = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: { not: 'super_admin' }, id: { in: [...online] } }, select: { id: true, name: true, role: true } });
    if (!agents.length) return;
    const openCount = await this.openCount(tenantId, agents.map((a) => a.id));
    const nome = new Map(agents.map((a) => [a.id, a.name]));
    const max = cfg.autoDistributeMax;

    for (const c of fila) {
      // todo mundo no limite: o resto espera (não adianta conferir conversa por conversa)
      if (agents.every((a) => (openCount[a.id] ?? 0) >= max)) break;
      const eligible = await this.conversations.receiversOf(tenantId, c, agents);
      const chosen = pickQueueAgent(eligible, openCount, max);
      if (!chosen) continue;
      const n = (openCount[chosen] ?? 0) + 1;
      const note = `📥 Distribuído pela fila para ${nome.get(chosen)} (${n} de ${max} atendimentos).`;
      if (!(await this.conversations.distributeSystem(tenantId, c, { id: chosen, name: nome.get(chosen)! }, QUEUE_REASON, note))) continue;
      openCount[chosen] = n;
      this.log.log(`cliente ${tenantId}: conversa ${c.id} da fila para ${chosen} (${n}/${max})`);
    }
  }

  /** Atendimentos abertos por pessoa — a mesma conta da distribuição, do limite e da tela. */
  private async openCount(tenantId: string, ids: string[]): Promise<Record<string, number>> {
    if (!ids.length) return {};
    const open = await this.prisma.conversation.groupBy({ by: ['assigneeId'], where: { tenantId, ...ATENDIMENTO, assigneeId: { in: ids }, status: { not: 'closed' } }, _count: { _all: true } });
    return Object.fromEntries(open.map((o) => [o.assigneeId!, o._count._all]));
  }

  /** Situação da fila para o painel. A equipe (quem está com quantos, quem está em pausa) só para quem vê todos. */
  async status(u: AuthUser): Promise<QueueStatus> {
    const tenantId = u.tenantId;
    const verTodos = u.role === 'super_admin' || !!u.permissions?.includes('conversations.view_all');
    const [cfg, waiting, pauses, online] = await Promise.all([
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { autoDistribute: true, autoDistributeMax: true, autoDistributeLockClaim: true } }),
      this.prisma.conversation.count({ where: { tenantId, ...NA_FILA } }),
      this.pauses.openByTenant(tenantId),
      this.gateway.onlineUserIds(tenantId),
    ]);
    const max = cfg?.autoDistributeMax ?? 4;
    const users = verTodos
      ? await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: { not: 'super_admin' } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : [];
    const open = await this.openCount(tenantId, [...new Set([u.id, ...users.map((x) => x.id)])]);
    const team: QueueAgent[] | undefined = verTodos
      ? users
          .map((x) => {
            const pause = pauses.get(x.id) ?? null;
            const n = open[x.id] ?? 0;
            const state: QueueAgent['state'] = !online.has(x.id) ? 'offline' : pause ? 'paused' : n >= max ? 'full' : 'available';
            return { id: x.id, name: x.name, state, open: n, pause };
          })
          // quem está trabalhando primeiro
          .sort((a, b) => Number(a.state === 'offline') - Number(b.state === 'offline'))
      : undefined;
    return {
      enabled: !!cfg?.autoDistribute,
      maxPerAgent: max,
      lockClaim: !!cfg?.autoDistributeLockClaim,
      waiting,
      me: { open: open[u.id] ?? 0, pause: pauses.get(u.id) ?? null, online: online.has(u.id) },
      ...(team && { team }),
    };
  }
}

class PauseDto {
  @IsIn(Object.keys(AGENT_PAUSE_REASONS)) reason: AgentPauseReason;
  /** vazio = até eu voltar */
  @IsOptional() @IsInt() @Min(5) @Max(AGENT_PAUSE_MAX_MINUTES) minutes?: number;
}

/** Fila e pausa (docs/fila-de-atendimento.md). Qualquer pessoa da equipe usa a própria pausa. */
@Controller('queue')
@UseGuards(JwtAuthGuard, TenantGuard)
class AttendanceQueueController {
  constructor(
    private readonly queue: AttendanceQueueService,
    private readonly pauses: AgentPauseService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  status(@CurrentUser() u: AuthUser) {
    return this.queue.status(u);
  }

  @Post('pause')
  async pause(@CurrentUser() u: AuthUser, @Body() dto: PauseDto) {
    if (u.impersonatorId) throw new BadRequestException('Quem está "entrando como" não entra em pausa pela pessoa.');
    const p = await this.pauses.pause(u.tenantId, u.id, dto.reason, dto.minutes ?? null);
    return { pause: p };
  }

  @Post('resume')
  async resume(@CurrentUser() u: AuthUser) {
    const r = await this.pauses.resume(u.tenantId, u.id, u.id);
    this.queue.kick(u.tenantId);
    return r;
  }

  /** Gerente tira alguém da pausa (esqueceu ligado). */
  @Post('agents/:id/resume')
  async resumeOther(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (!(u.role === 'super_admin' || u.permissions?.includes('conversations.view_all'))) throw new ForbiddenException('Só quem acompanha a equipe tira outra pessoa da pausa.');
    const alvo = await this.prisma.user.findFirst({ where: { id, tenantId: u.tenantId }, select: { id: true } });
    if (!alvo) throw new NotFoundException('Pessoa não encontrada.');
    const r = await this.pauses.resume(u.tenantId, id, u.id);
    this.queue.kick(u.tenantId);
    return r;
  }
}

/** Rodada a cada 20 s (pausas vencidas + clientes com a fila ligada). Idempotente entre instâncias. */
@Injectable()
class AttendanceQueueScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_ATTENDANCE) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('attendance-queue', { every: 20_000 }, { name: 'sweep' });
  }
}

@Processor(QUEUE_ATTENDANCE)
class AttendanceQueueProcessor extends TrackedWorkerHost {
  constructor(private readonly service: AttendanceQueueService) {
    super(QUEUE_ATTENDANCE);
  }
  protected async handle(job: Job) {
    if (job.name === 'tenant') await this.service.runTenant((job.data as { tenantId: string }).tenantId);
    else await this.service.runDue();
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_ATTENDANCE, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } }), AuthModule, ConversationsModule],
  controllers: [AttendanceQueueController],
  providers: [AttendanceQueueService, AgentPauseService, AttendanceQueueScheduler, AttendanceQueueProcessor],
  exports: [AttendanceQueueService, AgentPauseService],
})
export class AttendanceQueueModule {}

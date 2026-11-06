import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppLogger } from '../../common/observability/app-logger';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { AUTO_REASSIGN_REASON, pickReassignTarget, reassignAfterMinutes, waitingClockStart } from './auto-reassign';

export const QUEUE_AUTO_REASSIGN = 'auto-reassign';
/** por rodada e por cliente: o resto fica para o próximo minuto (a fila não trava o worker) */
const BATCH = 50;

/**
 * Redistribuição automática de conversas órfãs (docs/redistribuicao-automatica.md). A cada minuto,
 * para cada cliente com a regra ligada: mede a carga, calcula o tempo (base → teto) e passa para o
 * atendente online menos ocupado as conversas cujo contato espera resposta há mais que isso.
 */
@Injectable()
export class AutoReassignService {
  private readonly log = new AppLogger(AutoReassignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly gateway: ConversationsGateway,
  ) {}

  async runDue(now = new Date()) {
    const tenants = await this.prisma.tenantSettings.findMany({
      where: { OR: [{ autoReassignWaiting: true }, { autoReassignAssigned: true }], tenant: { isActive: true } },
      select: { tenantId: true, autoReassignWaiting: true, autoReassignAssigned: true, autoReassignBaseMinutes: true, autoReassignMaxMinutes: true, autoReassignMaxTimes: true },
    });
    for (const t of tenants) {
      await this.runTenant(t, now).catch((e) => this.log.warn(`redistribuição do cliente ${t.tenantId} falhou: ${e instanceof Error ? e.message : e}`));
    }
  }

  private async runTenant(
    cfg: { tenantId: string; autoReassignWaiting: boolean; autoReassignAssigned: boolean; autoReassignBaseMinutes: number; autoReassignMaxMinutes: number; autoReassignMaxTimes: number },
    now: Date,
  ) {
    const { tenantId } = cfg;
    // presença = painel aberto e no turno (mesma do bloco Distribuidor)
    const online = await this.gateway.availableUserIds(tenantId);
    const agents = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: { not: 'super_admin' }, id: { in: [...online] } }, select: { id: true, name: true, role: true } });
    if (!agents.length) return;

    // contato esperando resposta, fora robô, livres (isentos de ticket) e grupos
    const pendente: Prisma.ConversationWhereInput = { tenantId, status: { not: 'closed' }, awaitingSince: { not: null }, activeFlowRunId: null, ticketExempt: false, contact: { isGroup: false } };
    const waiting = await this.prisma.conversation.count({ where: pendente });
    const minutes = reassignAfterMinutes(cfg.autoReassignBaseMinutes, cfg.autoReassignMaxMinutes, waiting, agents.length);
    if (minutes === null) return;
    const cutoff = new Date(now.getTime() - minutes * 60_000);

    const escopos: Prisma.ConversationWhereInput[] = [
      ...(cfg.autoReassignWaiting ? [{ status: 'waiting' as const, assigneeId: null }] : []),
      ...(cfg.autoReassignAssigned ? [{ status: 'in_progress' as const, assigneeId: { not: null } }] : []),
    ];
    const candidates = await this.prisma.conversation.findMany({
      where: { ...pendente, awaitingSince: { lte: cutoff }, OR: escopos },
      orderBy: { awaitingSince: 'asc' },
      take: BATCH,
      select: { id: true, contactId: true, numberId: true, departmentId: true, assigneeId: true, status: true, awaitingSince: true, assignee: { select: { name: true } } },
    });
    if (!candidates.length) return;

    const ids = candidates.map((c) => c.id);
    const [handoffs, autos, open] = await Promise.all([
      // última troca de mãos: quem acabou de receber ganha o tempo inteiro
      this.prisma.conversationEvent.groupBy({ by: ['conversationId'], where: { conversationId: { in: ids }, type: { in: ['claimed', 'transferred', 'released'] } }, _max: { createdAt: true } }),
      this.prisma.conversationEvent.findMany({ where: { conversationId: { in: ids }, type: 'transferred', reason: AUTO_REASSIGN_REASON }, select: { conversationId: true, targetId: true, createdAt: true } }),
      this.prisma.conversation.groupBy({ by: ['assigneeId'], where: { tenantId, assigneeId: { in: agents.map((a) => a.id) }, status: { not: 'closed' } }, _count: { _all: true } }),
    ]);
    const lastHandoff = new Map(handoffs.map((h) => [h.conversationId, h._max.createdAt]));
    const openCount: Record<string, number> = Object.fromEntries(open.map((o) => [o.assigneeId!, o._count._all]));
    const onlineIds = new Set(agents.map((a) => a.id));
    const nome = new Map(agents.map((a) => [a.id, a.name]));

    for (const c of candidates) {
      const since = c.awaitingSince!;
      if (waitingClockStart(since, lastHandoff.get(c.id)) > cutoff) continue;
      // só as redistribuições DESTA espera contam no limite e no "já recebeu"
      const nestaEspera = autos.filter((a) => a.conversationId === c.id && a.createdAt >= since);
      if (nestaEspera.length >= cfg.autoReassignMaxTimes) continue;
      const exclude = new Set([...(c.assigneeId ? [c.assigneeId] : []), ...nestaEspera.map((a) => a.targetId).filter((x): x is string => !!x)]);
      const eligible = await this.conversations.receiversOf(tenantId, c, agents.filter((a) => !exclude.has(a.id)));
      const chosen = pickReassignTarget({ eligible, online: onlineIds, exclude, openCount });
      if (!chosen) continue;

      const esperou = Math.round((now.getTime() - waitingClockStart(since, lastHandoff.get(c.id)).getTime()) / 60_000);
      const de = c.assigneeId ? `${c.assignee?.name ?? 'o atendente'} não respondeu` : 'ninguém assumiu';
      const note = `🔁 Redistribuída automaticamente para ${nome.get(chosen)}: ${de} em ${esperou} min (limite agora: ${minutes} min).`;
      const ok = await this.conversations.reassignSystem(tenantId, { id: c.id, contactId: c.contactId, assigneeId: c.assigneeId, status: c.status, awaitingSince: since }, { id: chosen, name: nome.get(chosen)! }, AUTO_REASSIGN_REASON, note);
      if (!ok) continue;
      openCount[chosen] = (openCount[chosen] ?? 0) + 1;
      if (c.assigneeId) openCount[c.assigneeId] = Math.max(0, (openCount[c.assigneeId] ?? 1) - 1);
      this.log.log(`cliente ${tenantId}: conversa ${c.id} redistribuída para ${chosen} (${esperou} min, limite ${minutes})`);
    }
  }
}

/** Verifica a cada minuto. `upsertJobScheduler` é idempotente entre instâncias. */
@Injectable()
class AutoReassignScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_AUTO_REASSIGN) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('auto-reassign', { every: 60_000 }, { name: 'auto-reassign' });
  }
}

@Processor(QUEUE_AUTO_REASSIGN)
class AutoReassignProcessor extends TrackedWorkerHost {
  constructor(private readonly service: AutoReassignService) {
    super(QUEUE_AUTO_REASSIGN);
  }
  protected async handle(_job: Job) {
    await this.service.runDue();
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_AUTO_REASSIGN, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } }), ConversationsModule],
  providers: [AutoReassignService, AutoReassignScheduler, AutoReassignProcessor],
})
export class AutoReassignModule {}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumbersService } from './numbers.service';
import { ProviderRegistry } from './providers/provider.registry';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { QUEUE_OUTBOUND, type OutboundJob } from './queues';
import { resumeNumber } from './send-queue';
import { isReceiveStalled, unackedSinceLastSignal } from './receive-stall';
import type { NumberStatus } from '@prisma/client';

export const QUEUE_HEALTH = 'wa-health';

/** A cada 5 min confere no provider se cada número ativo continua conectado e corrige o status no banco. */
@Injectable()
export class NumbersHealthScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_HEALTH) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('numbers-health', { every: 5 * 60_000 }, { name: 'check' });
  }
}

@Processor(QUEUE_HEALTH)
export class NumbersHealthProcessor extends TrackedWorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumbersService,
    private readonly registry: ProviderRegistry,
    private readonly gateway: ConversationsGateway,
    @InjectQueue(QUEUE_OUTBOUND) private readonly outbound: Queue<OutboundJob>,
  ) {
    super(QUEUE_HEALTH);
  }
  protected async handle(_job: Job) {
    const list = await this.prisma.whatsAppNumber.findMany({ where: { isActive: true, status: { not: 'pending_qr' } } });
    for (const n of list) {
      try {
        const ctx = await this.numbers.context(n.id);
        const status = await this.registry.get(n.provider).getStatus(ctx);
        if (status !== n.status) {
          await this.prisma.whatsAppNumber.update({ where: { id: n.id }, data: { status } });
          this.gateway.emitNumber(n.tenantId, { id: n.id, status });
          this.log.warn(`Número ${n.label}: ${n.status} → ${status}`);
          // voltou sem passar pelo webhook de conexão: retoma a fila parada do número
          if (status === 'connected') await resumeNumber(this.prisma, this.outbound, n.id);
        }
        await this.checkReceiving(n, status);
      } catch (err) {
        this.log.warn(`health ${n.label}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /**
   * Conectado, mas recebendo nada (receive-stall.ts). Só Conexão Web: é lá que as chaves de
   * recebimento corrompem sem derrubar a sessão. Marca e desmarca sozinho — ler o QR de novo
   * muda `sessionStartedAt`, e as mensagens de antes deixam de contar.
   */
  private async checkReceiving(n: { id: string; tenantId: string; label: string; provider: string; sessionStartedAt: Date | null; receiveStalledAt: Date | null }, status: NumberStatus) {
    const stalled = n.provider === 'evolution' && status === 'connected' && isReceiveStalled(await unackedSinceLastSignal(this.prisma, n.id, n.sessionStartedAt));
    if (stalled === !!n.receiveStalledAt) return;
    await this.prisma.whatsAppNumber.update({ where: { id: n.id }, data: { receiveStalledAt: stalled ? new Date() : null } });
    this.gateway.emitNumber(n.tenantId, { id: n.id, status });
    if (stalled) this.log.warn(`Número ${n.label}: envia mas não recebe nem confirma entrega — precisa ler o QR de novo`);
    else this.log.log(`Número ${n.label}: voltou a receber`);
  }
}

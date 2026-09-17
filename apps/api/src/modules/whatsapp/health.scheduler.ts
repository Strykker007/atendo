import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumbersService } from './numbers.service';
import { ProviderRegistry } from './providers/provider.registry';
import { ConversationsGateway } from '../conversations/conversations.gateway';

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
export class NumbersHealthProcessor extends WorkerHost {
  private readonly log = new Logger(NumbersHealthProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumbersService,
    private readonly registry: ProviderRegistry,
    private readonly gateway: ConversationsGateway,
  ) {
    super();
  }
  async process(_job: Job) {
    const list = await this.prisma.whatsAppNumber.findMany({ where: { isActive: true, status: { not: 'pending_qr' } } });
    for (const n of list) {
      try {
        const ctx = await this.numbers.context(n.id);
        const status = await this.registry.get(n.provider).getStatus(ctx);
        if (status !== n.status) {
          await this.prisma.whatsAppNumber.update({ where: { id: n.id }, data: { status } });
          this.gateway.emitNumber(n.tenantId, { id: n.id, status });
          this.log.warn(`Número ${n.label}: ${n.status} → ${status}`);
        }
      } catch (err) {
        this.log.warn(`health ${n.label}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

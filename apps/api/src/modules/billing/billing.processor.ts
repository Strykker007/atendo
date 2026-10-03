import { Processor, InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { UsageService } from './usage.service';
import { StripeService } from './stripe.service';
import { QUEUE_BILLING } from '../whatsapp/queues';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';

@Processor(QUEUE_BILLING)
export class BillingProcessor extends TrackedWorkerHost {
  constructor(
    private readonly usage: UsageService,
    private readonly stripe: StripeService,
  ) {
    super(QUEUE_BILLING);
  }
  protected async handle(job: Job) {
    if (job.name === 'reconcile') {
      await this.usage.reconcile();
      // carência vencida sem pagamento → suspende (envio bloqueado, recebimento continua)
      await this.stripe.suspendOverdue();
      // reajustes cuja data de aviso prévio venceu
      await this.stripe.applyDuePriceChanges();
    }
  }
}

/** Agenda a reconciliação diária (03:00 UTC). Idempotente entre instâncias. */
@Injectable()
export class BillingScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_BILLING) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('daily-reconcile', { pattern: '0 3 * * *' }, { name: 'reconcile' });
  }
}

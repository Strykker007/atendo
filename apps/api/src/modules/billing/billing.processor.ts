import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { UsageService } from './usage.service';
import { QUEUE_BILLING } from '../whatsapp/queues';

@Processor(QUEUE_BILLING)
export class BillingProcessor extends WorkerHost {
  constructor(private readonly usage: UsageService) {
    super();
  }
  async process(job: Job) {
    if (job.name === 'reconcile') await this.usage.reconcile();
    // TODO: 'close-period' -> gera Invoice e envia ao gateway
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

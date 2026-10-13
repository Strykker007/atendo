import { Processor, InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { UsageService } from './usage.service';
import { StripeService } from './stripe.service';
import { DuesService } from './dues.service';
import { PlanOverridesService } from './plan-overrides.service';
import { QUEUE_BILLING } from '../whatsapp/queues';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';

@Processor(QUEUE_BILLING)
export class BillingProcessor extends TrackedWorkerHost {
  constructor(
    private readonly usage: UsageService,
    private readonly stripe: StripeService,
    private readonly dues: DuesService,
    private readonly overrides: PlanOverridesService,
  ) {
    super(QUEUE_BILLING);
  }
  protected async handle(job: Job) {
    if (job.name === 'reconcile') {
      await this.usage.reconcile();
      // carência vencida sem pagamento → suspende (envio bloqueado, recebimento continua)
      await this.stripe.suspendOverdue();
      // degustação gratuita vencida → suspende; gratuito permanente só rola a data
      await this.stripe.expireFreePlans();
      // personalização de plano vencida → valor do plano volta à assinatura (limites já voltaram na leitura)
      await this.overrides.expireDue();
      // reajustes cuja data de aviso prévio venceu
      await this.stripe.applyDuePriceChanges();
      // grupos consolidados cuja contagem de empresas não chegou ao Asaas
      await this.dues.syncAllGroups();
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

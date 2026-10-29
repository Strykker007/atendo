import { Processor, InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { UsageService } from './usage.service';
import { StripeService } from './stripe.service';
import { DuesService } from './dues.service';
import { PlanOverridesService } from './plan-overrides.service';
import { MonthlyBillingService } from './monthly-billing.service';
import { env } from '../../config/env';
import { QUEUE_BILLING } from '../whatsapp/queues';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';

@Processor(QUEUE_BILLING)
export class BillingProcessor extends TrackedWorkerHost {
  constructor(
    private readonly usage: UsageService,
    private readonly stripe: StripeService,
    private readonly dues: DuesService,
    private readonly overrides: PlanOverridesService,
    private readonly monthly: MonthlyBillingService,
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
    if (job.name === 'monthly-reminders') {
      // mensalidade por Pix (docs/05#migração-para-o-asaas): migra quem já pode (só com
      // ASAAS_AUTO_ENROLL) e manda os lembretes com o Pix por e-mail
      if (env.ASAAS_AUTO_ENROLL && this.monthly.enabled) await this.monthly.enrollAll({ dryRun: false });
      await this.monthly.sendReminders();
    }
  }
}

/** Agenda a reconciliação diária (03:00 UTC) e os lembretes da mensalidade (12:00 UTC). Idempotente entre instâncias. */
@Injectable()
export class BillingScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_BILLING) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('daily-reconcile', { pattern: '0 3 * * *' }, { name: 'reconcile' });
    // 12:00 UTC = 9h em Brasília: lembrete de cobrança chega em horário comercial, não de madrugada
    await this.queue.upsertJobScheduler('monthly-reminders', { pattern: '0 12 * * *' }, { name: 'monthly-reminders' });
  }
}

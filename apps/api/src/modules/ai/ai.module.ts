import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { AiProviderRegistry } from './ai-provider.registry';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';

export const QUEUE_AI = 'ai';

/** Reconcilia os contadores de IA a partir do ledger (03:10 UTC, logo após o de mensagens). */
@Injectable()
class AiReconcileScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_AI) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('daily-ai-reconcile', { pattern: '10 3 * * *' }, { name: 'reconcile' });
  }
}

@Processor(QUEUE_AI)
class AiProcessor extends TrackedWorkerHost {
  constructor(private readonly usage: AiUsageService) {
    super(QUEUE_AI);
  }
  protected async handle(job: Job) {
    if (job.name === 'reconcile') await this.usage.reconcile();
  }
}

/** IA: copiloto do atendente (controller) e motor de fluxos (AiService exportado). */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_AI, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } }), AuthModule, BillingModule],
  controllers: [AiController],
  providers: [AiService, AiUsageService, AiProviderRegistry, AnthropicProvider, OpenAiProvider, AiReconcileScheduler, AiProcessor],
  exports: [AiService, AiUsageService],
})
export class AiModule {}

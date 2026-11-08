import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { AiController } from './ai.controller';
import { AiAgentsController, AiAgentsService } from './ai-agents';
import { AiOwnKeyController, AiOwnKeyService } from './ai-own-key';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { AiProviderRegistry } from './ai-provider.registry';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { KnowledgeService } from './knowledge.service';
import { embedModel, embeddingsOn } from './providers/embeddings';

export const QUEUE_AI = 'ai';

/** Reconcilia os contadores de IA a partir do ledger (03:10 UTC, logo após o de mensagens). */
@Injectable()
class AiReconcileScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_AI) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('daily-ai-reconcile', { pattern: '10 3 * * *' }, { name: 'reconcile' });
    // chave de embedding recém-configurada (ou modelo trocado): gera o que faltar dos documentos já enviados
    if (embeddingsOn()) await this.queue.add('knowledge-embed', {}, { jobId: `knowledge-backfill-${embedModel().replace(/[^a-z0-9-]/gi, '_')}`, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } });
  }
}

@Processor(QUEUE_AI)
class AiProcessor extends TrackedWorkerHost {
  constructor(
    private readonly usage: AiUsageService,
    private readonly knowledge: KnowledgeService,
  ) {
    super(QUEUE_AI);
  }
  protected async handle(job: Job) {
    if (job.name === 'reconcile') await this.usage.reconcile();
    // embeddings dos documentos do agente: de um documento ou tudo que falta (docs/agente-ia.md#documentos)
    if (job.name === 'knowledge-embed') await this.knowledge.embedPending((job.data as { docId?: string })?.docId);
  }
}

/** IA: copiloto do atendente, agentes com etapas (docs/agente-ia.md) e motor de fluxos (AiService exportado). */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_AI, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } }), AuthModule, BillingModule],
  controllers: [AiController, AiAgentsController, AiOwnKeyController],
  providers: [AiService, AiAgentsService, KnowledgeService, AiOwnKeyService, AiUsageService, AiProviderRegistry, AnthropicProvider, OpenAiProvider, AiReconcileScheduler, AiProcessor],
  exports: [AiService, AiUsageService, AiAgentsService],
})
export class AiModule {}

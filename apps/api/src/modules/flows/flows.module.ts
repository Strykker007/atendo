import { Module, forwardRef } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { FlowEngineService, QUEUE_FLOWS, type BotUnpauseJob, type FlowJob, type FlowResumeJob, type ReplyTimeoutJob } from './flow-engine.service';
import { FlowsController, FlowStopController } from './flows.controller';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AiModule } from '../ai/ai.module';
import { TenantsModule } from '../tenants/tenants.module';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';

/** Retoma runs em "Aguardar" quando o tempo vence; tempo limite de resposta (Salvar/Menu); encerra a pausa do robô no horário. */
@Processor(QUEUE_FLOWS)
class FlowsProcessor extends TrackedWorkerHost<FlowJob> {
  constructor(private readonly engine: FlowEngineService) {
    super(QUEUE_FLOWS);
  }
  protected async handle(job: Job<FlowJob>) {
    if (job.name === 'resume') await this.engine.resume((job.data as FlowResumeJob).runId);
    if (job.name === 'unpause') await this.engine.autoResumeBot(job.data as BotUnpauseJob);
    if (job.name === 'reply-timeout') await this.engine.replyTimeout(job.data as ReplyTimeoutJob);
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_FLOWS }), AuthModule, BillingModule, forwardRef(() => ConversationsModule), forwardRef(() => SchedulingModule), AiModule, TenantsModule],
  controllers: [FlowsController, FlowStopController],
  providers: [FlowEngineService, FlowsProcessor],
  exports: [FlowEngineService],
})
export class FlowsModule {}

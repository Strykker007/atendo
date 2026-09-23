import { Module, forwardRef } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { FlowEngineService, QUEUE_FLOWS, type FlowResumeJob } from './flow-engine.service';
import { FlowsController, FlowStopController } from './flows.controller';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';

/** Retoma runs em "Aguardar" quando o tempo vence. */
@Processor(QUEUE_FLOWS)
class FlowsProcessor extends TrackedWorkerHost<FlowResumeJob> {
  constructor(private readonly engine: FlowEngineService) {
    super(QUEUE_FLOWS);
  }
  protected async handle(job: Job<FlowResumeJob>) {
    if (job.name === 'resume') await this.engine.resume(job.data.runId);
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_FLOWS }), AuthModule, BillingModule, forwardRef(() => ConversationsModule), forwardRef(() => SchedulingModule)],
  controllers: [FlowsController, FlowStopController],
  providers: [FlowEngineService, FlowsProcessor],
  exports: [FlowEngineService],
})
export class FlowsModule {}

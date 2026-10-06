import { Injectable, Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { Job, Queue } from 'bullmq';
import { SchedulingService } from './scheduling.service';
import { SchedulingController } from './scheduling.controller';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

export const QUEUE_SCHEDULING = 'scheduling';

/** Lembretes: verifica a cada minuto o que precisa disparar. */
@Injectable()
class RemindersScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_SCHEDULING) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('reminders', { every: 60_000 }, { name: 'reminders' });
  }
}
@Processor(QUEUE_SCHEDULING)
class RemindersProcessor extends TrackedWorkerHost {
  constructor(private readonly scheduling: SchedulingService) {
    super(QUEUE_SCHEDULING);
  }
  protected async handle(_job: Job) {
    await this.scheduling.runReminders();
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_SCHEDULING, defaultJobOptions: { removeOnComplete: 50, removeOnFail: 50 } }), AuthModule, BillingModule, TenantsModule, forwardRef(() => ConversationsModule), forwardRef(() => WhatsAppModule)],
  controllers: [SchedulingController],
  providers: [SchedulingService, RemindersScheduler, RemindersProcessor],
  exports: [SchedulingService],
})
export class SchedulingModule {}

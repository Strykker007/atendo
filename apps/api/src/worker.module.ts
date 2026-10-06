import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CoreModule } from './common/core.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { BillingModule } from './modules/billing/billing.module';
import { FlowsModule } from './modules/flows/flows.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { AiModule } from './modules/ai/ai.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { ScheduledMessagesModule } from './modules/scheduled-messages/scheduled-messages.module';
import { env } from './config/env';

@Module({
  imports: [
    CoreModule,
    BullModule.forRoot({ connection: { url: env.REDIS_URL } }),
    WhatsAppModule,
    ConversationsModule,
    BillingModule,
    FlowsModule,
    SchedulingModule,
    ScheduledMessagesModule,
    AiModule,
  ],
})
export class WorkerModule {}

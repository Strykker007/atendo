import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CoreModule } from './common/core.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { BillingModule } from './modules/billing/billing.module';
import { FlowsModule } from './modules/flows/flows.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { env } from './config/env';

@Module({
  imports: [
    CoreModule,
    BullModule.forRoot({ connection: { url: env.REDIS_URL } }),
    WhatsAppModule,
    ConversationsModule,
    BillingModule,
    FlowsModule,
  ],
})
export class WorkerModule {}

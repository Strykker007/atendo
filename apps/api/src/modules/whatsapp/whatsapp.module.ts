import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MetaProvider } from './providers/meta.provider';
import { EvolutionProvider } from './providers/evolution.provider';
import { ProviderRegistry } from './providers/provider.registry';
import { NumbersService } from './numbers.service';
import { NumbersController } from './numbers.controller';
import { WebhooksController } from './webhooks.controller';
import { GroupsController } from './groups.controller';
import { GroupInboxRegistry } from './group-inbox';
import { InboundProcessor } from './inbound.processor';
import { ConnectionEventsService } from './connection-events';
import { SessionProbe } from './session-probe';
import { OutboundProcessor } from './outbound.processor';
import { QUEUE_INBOUND, QUEUE_OUTBOUND } from './queues';
import { SendPacer } from './send-pacer';
import { OUTBOUND_JOB_OPTS } from './send-queue';
import { NumbersHealthScheduler, NumbersHealthProcessor, QUEUE_HEALTH } from './health.scheduler';
import { ContactsSyncProcessor, ContactsSyncScheduler, QUEUE_CONTACTS_SYNC } from './contacts-sync';
import { HistoryMediaProcessor, HistorySyncService, QUEUE_HISTORY_MEDIA } from './history-sync';
import { ConversationsModule } from '../conversations/conversations.module';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';
import { FlowsModule } from '../flows/flows.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_INBOUND, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } } },
      { name: QUEUE_OUTBOUND, defaultJobOptions: OUTBOUND_JOB_OPTS },
      { name: QUEUE_HEALTH, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 20 } },
      { name: QUEUE_CONTACTS_SYNC, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 20 } },
      { name: QUEUE_HISTORY_MEDIA, defaultJobOptions: { removeOnComplete: true, removeOnFail: 50, attempts: 2, backoff: { type: 'exponential', delay: 5000 } } },
    ),
    forwardRef(() => ConversationsModule),
    BillingModule,
    AuthModule,
    forwardRef(() => FlowsModule),
    forwardRef(() => SchedulingModule),
  ],
  controllers: [NumbersController, WebhooksController, GroupsController],
  providers: [MetaProvider, EvolutionProvider, ProviderRegistry, NumbersService, InboundProcessor, OutboundProcessor, NumbersHealthScheduler, NumbersHealthProcessor, ContactsSyncScheduler, ContactsSyncProcessor, HistorySyncService, HistoryMediaProcessor, SendPacer, ConnectionEventsService, SessionProbe, GroupInboxRegistry],
  exports: [ProviderRegistry, NumbersService, HistorySyncService, SendPacer, BullModule],
})
export class WhatsAppModule {}

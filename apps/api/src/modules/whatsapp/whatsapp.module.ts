import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MetaProvider } from './providers/meta.provider';
import { EvolutionProvider } from './providers/evolution.provider';
import { ProviderRegistry } from './providers/provider.registry';
import { NumbersService } from './numbers.service';
import { NumbersController } from './numbers.controller';
import { WebhooksController } from './webhooks.controller';
import { InboundProcessor } from './inbound.processor';
import { OutboundProcessor } from './outbound.processor';
import { QUEUE_INBOUND, QUEUE_OUTBOUND } from './queues';
import { ConversationsModule } from '../conversations/conversations.module';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_INBOUND, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } } },
      { name: QUEUE_OUTBOUND, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } } },
    ),
    forwardRef(() => ConversationsModule),
    BillingModule,
    AuthModule,
  ],
  controllers: [NumbersController, WebhooksController],
  providers: [MetaProvider, EvolutionProvider, ProviderRegistry, NumbersService, InboundProcessor, OutboundProcessor],
  exports: [ProviderRegistry, NumbersService, BullModule],
})
export class WhatsAppModule {}

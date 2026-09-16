import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsGateway } from './conversations.gateway';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { QUEUE_OUTBOUND } from '../whatsapp/queues';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_OUTBOUND }), AuthModule, BillingModule, forwardRef(() => WhatsAppModule)],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsGateway],
  exports: [ConversationsService, ConversationsGateway],
})
export class ConversationsModule {}

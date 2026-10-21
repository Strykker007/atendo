import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsService } from './conversations.service';
import { InboundService } from './inbound.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsGateway } from './conversations.gateway';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { QUEUE_GAP_RECOVERY, QUEUE_OUTBOUND } from '../whatsapp/queues';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { FlowsModule } from '../flows/flows.module';
import { ConversationScopeGuard } from './conversation-scope.guard';
import { CloseReasonsModule } from '../close-reasons/close-reasons.module';
import { AuditModule } from '../audit/audit.module';
import { SurveyRunnerService } from '../satisfaction/survey-runner.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_OUTBOUND }, { name: QUEUE_GAP_RECOVERY }), AuthModule, BillingModule, CloseReasonsModule, AuditModule, forwardRef(() => WhatsAppModule), forwardRef(() => FlowsModule)],
  controllers: [ConversationsController],
  providers: [ConversationsService, InboundService, ConversationsGateway, ConversationScopeGuard, SurveyRunnerService],
  exports: [ConversationsService, InboundService, ConversationsGateway, SurveyRunnerService],
})
export class ConversationsModule {}

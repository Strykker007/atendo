import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { CoreModule } from './common/core.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { TagsModule } from './modules/tags/tags.module';
import { ContactAttributesModule } from './modules/contact-attributes/contact-attributes.module';
import { QuickRepliesModule } from './modules/quick-replies/quick-replies.module';
import { BillingModule } from './modules/billing/billing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { MediaModule } from './modules/media/media.module';
import { FlowsModule } from './modules/flows/flows.module';
import { HealthController } from './modules/health.controller';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { AiModule } from './modules/ai/ai.module';
import { env } from './config/env';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { KanbanModule } from './modules/kanban/kanban.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { ScheduledMessagesModule } from './modules/scheduled-messages/scheduled-messages.module';

@Module({
  imports: [
    CoreModule,
    ObservabilityModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRoot({ connection: { url: env.REDIS_URL } }),
    AuthModule,
    TenantsModule,
    WhatsAppModule,
    ConversationsModule,
    TagsModule,
    ContactAttributesModule,
    DepartmentsModule,
    KanbanModule,
    QuickRepliesModule,
    BillingModule,
    ReportsModule,
    CampaignsModule,
    MediaModule,
    FlowsModule,
    SchedulingModule,
    ScheduledMessagesModule,
    AiModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

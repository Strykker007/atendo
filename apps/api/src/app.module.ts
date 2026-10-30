import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { CoreModule } from './common/core.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { TenantLifecycleModule } from './modules/tenants/tenant-lifecycle.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { TagsModule } from './modules/tags/tags.module';
import { ContactAttributesModule } from './modules/contact-attributes/contact-attributes.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { GlobalVariablesModule } from './modules/global-variables/global-variables.module';
import { QuickRepliesModule } from './modules/quick-replies/quick-replies.module';
import { PixKeysModule } from './modules/pix-keys/pix-keys.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { SecureMediaModule } from './modules/secure-media/secure-media.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CloseReasonsModule } from './modules/close-reasons/close-reasons.module';
import { SatisfactionModule } from './modules/satisfaction/satisfaction.module';
import { GoalsModule } from './modules/goals/goals.module';
import { AuditModule } from './modules/audit/audit.module';
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
import { CompaniesModule } from './modules/companies/companies.module';
import { ScheduledMessagesModule } from './modules/scheduled-messages/scheduled-messages.module';
import { NoticesModule } from './modules/notices/notices.module';
import { MonitorModule } from './modules/monitor/monitor.module';
import { IgnoredContactsModule } from './modules/ignored-contacts/ignored-contacts.module';
import { InternalChatModule } from './modules/internal-chat/internal-chat.module';
import { WorkSchedulesModule } from './modules/work-schedules/work-schedules.module';

@Module({
  imports: [
    CoreModule,
    ObservabilityModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRoot({ connection: { url: env.REDIS_URL } }),
    AuthModule,
    TenantsModule,
    TenantLifecycleModule,
    TicketsModule,
    WhatsAppModule,
    ConversationsModule,
    TagsModule,
    ContactAttributesModule,
    ContactsModule,
    GlobalVariablesModule,
    DepartmentsModule,
    CompaniesModule,
    KanbanModule,
    QuickRepliesModule,
    PixKeysModule,
    BudgetsModule,
    SecureMediaModule,
    PaymentsModule,
    CloseReasonsModule,
    SatisfactionModule,
    GoalsModule,
    AuditModule,
    BillingModule,
    ReportsModule,
    CampaignsModule,
    MediaModule,
    FlowsModule,
    SchedulingModule,
    ScheduledMessagesModule,
    AiModule,
    NoticesModule,
    MonitorModule,
    IgnoredContactsModule,
    InternalChatModule,
    WorkSchedulesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

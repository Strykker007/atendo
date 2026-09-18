import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { CoreModule } from './common/core.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { TagsModule } from './modules/tags/tags.module';
import { QuickRepliesModule } from './modules/quick-replies/quick-replies.module';
import { BillingModule } from './modules/billing/billing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { MediaModule } from './modules/media/media.module';
import { FlowsModule } from './modules/flows/flows.module';
import { HealthController } from './modules/health.controller';
import { env } from './config/env';

@Module({
  imports: [
    CoreModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRoot({ connection: { url: env.REDIS_URL } }),
    AuthModule,
    TenantsModule,
    WhatsAppModule,
    ConversationsModule,
    TagsModule,
    QuickRepliesModule,
    BillingModule,
    ReportsModule,
    MediaModule,
    FlowsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

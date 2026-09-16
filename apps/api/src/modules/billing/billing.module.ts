import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PricingService } from './pricing.service';
import { UsageService } from './usage.service';
import { PlanLimitGuard } from './plan-limit.guard';
import { BillingController } from './billing.controller';
import { BillingProcessor, BillingScheduler } from './billing.processor';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_BILLING } from '../whatsapp/queues';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_BILLING }), AuthModule],
  controllers: [BillingController],
  providers: [PricingService, UsageService, PlanLimitGuard, BillingProcessor, BillingScheduler],
  exports: [PricingService, UsageService, PlanLimitGuard],
})
export class BillingModule {}

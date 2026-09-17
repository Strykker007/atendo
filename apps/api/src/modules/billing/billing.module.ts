import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PricingService } from './pricing.service';
import { UsageService } from './usage.service';
import { PlanLimitGuard } from './plan-limit.guard';
import { BillingController } from './billing.controller';
import { BillingProcessor, BillingScheduler } from './billing.processor';
import { StripeService } from './stripe.service';
import { FinanceService } from './finance.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_BILLING } from '../whatsapp/queues';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_BILLING }), AuthModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [PricingService, UsageService, PlanLimitGuard, BillingProcessor, BillingScheduler, StripeService, FinanceService],
  exports: [PricingService, UsageService, PlanLimitGuard, StripeService],
})
export class BillingModule {}

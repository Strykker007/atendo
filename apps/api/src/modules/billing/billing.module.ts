import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PricingService } from './pricing.service';
import { UsageService } from './usage.service';
import { PlanLimitGuard } from './plan-limit.guard';
import { BillingController } from './billing.controller';
import { BillingProcessor, BillingScheduler } from './billing.processor';
import { StripeService } from './stripe.service';
import { FinanceService } from './finance.service';
import { FeatureGuard } from './feature.guard';
import { StripeWebhookController } from './stripe-webhook.controller';
import { AsaasService } from './asaas.service';
import { AsaasController, AsaasWebhookController } from './asaas.controller';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_BILLING } from '../whatsapp/queues';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_BILLING }), AuthModule],
  controllers: [BillingController, StripeWebhookController, AsaasController, AsaasWebhookController],
  providers: [PricingService, UsageService, PlanLimitGuard, BillingProcessor, BillingScheduler, StripeService, AsaasService, FinanceService, FeatureGuard],
  exports: [PricingService, UsageService, PlanLimitGuard, StripeService, AsaasService, FeatureGuard],
})
export class BillingModule {}

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
import { DuesService } from './dues.service';
import { DuesController } from './dues.controller';
import { PlanOverridesService } from './plan-overrides.service';
import { PlanOverridesController } from './plan-overrides.controller';
import { PromotionsService } from './promotions.service';
import { DiscountLedgerService } from './discount-ledger.service';
import { PromotionsController } from './promotions.controller';
import { MonthlyBillingService } from './monthly-billing.service';
import { MonthlyBillingController, PixQrController } from './monthly-billing.controller';
import { ActivationService } from './activation.service';
import { ActivationController } from './activation.controller';
import { FinanceClosingService } from './finance-closing.service';
import { FinanceClosingController } from './finance-closing.controller';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_BILLING } from '../whatsapp/queues';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_BILLING }), AuthModule],
  controllers: [BillingController, StripeWebhookController, AsaasController, AsaasWebhookController, DuesController, PlanOverridesController, PromotionsController, MonthlyBillingController, PixQrController, ActivationController, FinanceClosingController],
  providers: [PricingService, UsageService, PlanLimitGuard, BillingProcessor, BillingScheduler, StripeService, AsaasService, FinanceService, FeatureGuard, DuesService, PlanOverridesService, PromotionsService, DiscountLedgerService, MonthlyBillingService, ActivationService, FinanceClosingService],
  exports: [PricingService, UsageService, PlanLimitGuard, StripeService, AsaasService, FeatureGuard, DuesService, PlanOverridesService, PromotionsService, DiscountLedgerService],
})
export class BillingModule {}

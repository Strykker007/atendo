import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PartnerCommissionsService } from './partner-commissions.service';
import { PartnerPayoutsService } from './partner-payouts.service';
import { PartnerPortalService } from './partner-portal.service';
import { PartnersService } from './partners.service';
import { PayoutSecurityService } from './payout-security.service';
import { AsaasTransferValidationController, PartnerPayoutsController, PartnerPortalController, PartnerProgramController, PartnersAdminController } from './partners.controller';

/** VogoPartners — parceiros, comissões e pagamentos (docs/37-vogopartners.md). */
@Module({
  imports: [AuthModule, BillingModule, TenantsModule],
  controllers: [PartnersAdminController, PartnerProgramController, PartnerPayoutsController, PartnerPortalController, AsaasTransferValidationController],
  providers: [PartnerCommissionsService, PartnerPayoutsService, PartnerPortalService, PartnersService, PayoutSecurityService],
  // custo por cliente estima a comissão do mês ainda não apurada (finance-reports/client-costs)
  exports: [PartnerCommissionsService],
})
export class PartnersModule {}

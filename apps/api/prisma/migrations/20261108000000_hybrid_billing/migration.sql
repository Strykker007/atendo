-- Faturamento híbrido: empresa com assinatura própria ou herdada do grupo (docs/empresas.md#cobrança)
CREATE TYPE "BillingType" AS ENUM ('INDIVIDUAL', 'CONSOLIDATED_GROUP');

ALTER TABLE "tenants" ADD COLUMN "billingType" "BillingType" NOT NULL DEFAULT 'INDIVIDUAL';

ALTER TABLE "companies" ADD COLUMN "billingType" "BillingType" NOT NULL DEFAULT 'CONSOLIDATED_GROUP',
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "subscriptions" ADD COLUMN "units" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "invoices" ADD COLUMN "items" JSONB;

CREATE TABLE "company_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "priceMonth" DECIMAL(10,2),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_subscriptions_companyId_key" ON "company_subscriptions"("companyId");
CREATE INDEX "company_subscriptions_tenantId_idx" ON "company_subscriptions"("tenantId");

ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

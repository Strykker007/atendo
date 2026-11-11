-- Saldo de IA pré-pago (docs/15-ia.md#saldo-de-ia). Aditiva.
ALTER TABLE "ai_usage" ADD COLUMN "creditBrl" DECIMAL(12,6) NOT NULL DEFAULT 0;
ALTER TABLE "platform_settings" ADD COLUMN "aiCreditMarkupPct" INTEGER NOT NULL DEFAULT 100;

CREATE TABLE "ai_credit_wallets" (
    "tenantId" TEXT NOT NULL,
    "balanceBrl" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "autoUseOnFreeLimit" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_credit_wallets_pkey" PRIMARY KEY ("tenantId")
);

CREATE TABLE "ai_credit_purchases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amountBrl" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "externalId" TEXT,
    "invoiceUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidVia" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_credit_purchases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_credit_purchases_externalId_key" ON "ai_credit_purchases"("externalId");
CREATE INDEX "ai_credit_purchases_tenantId_createdAt_idx" ON "ai_credit_purchases"("tenantId", "createdAt");

ALTER TABLE "ai_credit_wallets" ADD CONSTRAINT "ai_credit_wallets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_credit_purchases" ADD CONSTRAINT "ai_credit_purchases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

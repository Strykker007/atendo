-- Pix automático no orçamento (docs/orcamentos.md#pix-automático)
ALTER TABLE "budgets" ADD COLUMN "paidVia" TEXT;
ALTER TABLE "budgets" ADD COLUMN "autoPix" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "budgets" ADD COLUMN "gatewayPaymentId" TEXT;
ALTER TABLE "budgets" ADD COLUMN "pixPayload" TEXT;
ALTER TABLE "budgets" ADD COLUMN "pixQrImage" TEXT;
CREATE UNIQUE INDEX "budgets_gatewayPaymentId_key" ON "budgets"("gatewayPaymentId");

CREATE TABLE "payment_gateways" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'asaas',
    "credentials" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "webhookToken" TEXT NOT NULL,
    "webhookId" TEXT,
    "accountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_gateways_tenantId_key" ON "payment_gateways"("tenantId");
ALTER TABLE "payment_gateways" ADD CONSTRAINT "payment_gateways_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cobrança de ativação (docs/05-planos-e-cobranca.md#cobrança-de-ativação). Aditiva: a API
-- anterior ignora a tabela e a coluna (padrão false = ninguém fica bloqueado).
ALTER TABLE "subscriptions" ADD COLUMN "awaitingActivation" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "activation_charges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(12,2) NOT NULL,
    "firstMonthValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "externalId" TEXT,
    "invoiceUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidVia" TEXT,
    "canceledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "activation_charges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activation_charges_externalId_key" ON "activation_charges"("externalId");
CREATE INDEX "activation_charges_tenantId_status_idx" ON "activation_charges"("tenantId", "status");
ALTER TABLE "activation_charges" ADD CONSTRAINT "activation_charges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fechamento financeiro do dono (docs/36-fechamento-financeiro.md). Só tabelas novas: aditiva.
CREATE TABLE "finance_recurring" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'expense',
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startPeriod" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "finance_recurring_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finance_entries" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "tenantId" TEXT,
    "recurringId" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "finance_entries_recurringId_period_key" ON "finance_entries"("recurringId", "period");
CREATE INDEX "finance_entries_period_idx" ON "finance_entries"("period");
CREATE INDEX "finance_entries_tenantId_idx" ON "finance_entries"("tenantId");
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "finance_recurring"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "finance_partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "pixKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "finance_partners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finance_closings" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "payouts" JSONB NOT NULL,
    "notes" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_closings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "finance_closings_period_key" ON "finance_closings"("period");

CREATE TABLE "finance_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "reservePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "openingDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

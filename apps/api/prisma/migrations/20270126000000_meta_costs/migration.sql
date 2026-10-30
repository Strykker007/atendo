-- Gasto com a Meta (docs/gasto-meta.md): orçamento do cliente + gasto real diário da WABA
ALTER TABLE "tenants" ADD COLUMN "metaBudgetMonth" DECIMAL(12,2);

CREATE TABLE "meta_cost_daily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "pricingCategory" TEXT NOT NULL,
    "pricingType" TEXT NOT NULL,
    "volume" INTEGER NOT NULL,
    "cost" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meta_cost_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_cost_daily_numberId_day_pricingCategory_pricingType_key" ON "meta_cost_daily"("numberId", "day", "pricingCategory", "pricingType");
CREATE INDEX "meta_cost_daily_tenantId_day_idx" ON "meta_cost_daily"("tenantId", "day");

ALTER TABLE "meta_cost_daily" ADD CONSTRAINT "meta_cost_daily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meta_cost_daily" ADD CONSTRAINT "meta_cost_daily_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "whatsapp_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "invoices_tenantId_period_key";

-- CreateIndex
CREATE INDEX "invoices_tenantId_period_idx" ON "invoices"("tenantId", "period");


-- Vencimento do orçamento: a cobrança do Asaas é cancelada depois da tolerância (docs/orcamentos.md#vencimento)
ALTER TABLE "budgets" ADD COLUMN "gatewayCancelledAt" TIMESTAMP(3);
CREATE INDEX "budgets_autoPix_status_expiresAt_idx" ON "budgets"("autoPix", "status", "expiresAt");

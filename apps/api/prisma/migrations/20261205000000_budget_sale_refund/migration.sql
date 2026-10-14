-- Orçamento pago vira venda na hora; encerramento "Comprou" absorve o pagamento sem duplicar;
-- estorno tira a venda (docs/orcamentos.md#venda). Motivo obrigatório separado por resultado.
ALTER TYPE "BudgetStatus" ADD VALUE 'REFUNDED';
ALTER TABLE "budgets" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "budgets" ADD COLUMN "closeEventId" TEXT;
CREATE INDEX "budgets_conversationId_status_idx" ON "budgets"("conversationId", "status");

ALTER TABLE "sales" ADD COLUMN "budgetId" TEXT;
ALTER TABLE "sales" ADD COLUMN "refundedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "sales_budgetId_key" ON "sales"("budgetId");

ALTER TABLE "tenant_settings" ADD COLUMN "requireReasonOnWon" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tenant_settings" ADD COLUMN "requireReasonOnLost" BOOLEAN NOT NULL DEFAULT true;

-- orçamentos já pagos (antes desta regra) viram venda, como os novos
INSERT INTO "sales" ("id", "tenantId", "conversationId", "contactId", "userId", "amount", "products", "notes", "closedAt", "budgetId")
SELECT gen_random_uuid(), b."tenantId", b."conversationId", b."contactId", b."userId", b."totalValue",
       left((SELECT string_agg(i->>'name', '; ') FROM jsonb_array_elements(b.items) i), 500),
       'Orçamento pago', COALESCE(b."paidAt", b."updatedAt"), b.id
FROM "budgets" b WHERE b.status = 'PAID';

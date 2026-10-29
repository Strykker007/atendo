-- Orçamento com aprovação (docs/orcamentos.md#orçamento-com-aprovação): número por empresa e
-- etapa "enviado por texto → aprovado → link". Só colunas opcionais: a API anterior segue igual.
ALTER TABLE "budgets" ADD COLUMN "number" INTEGER;
ALTER TABLE "budgets" ADD COLUMN "quotedAt" TIMESTAMP(3);
ALTER TABLE "budgets" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "budgets" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "budgets" ADD COLUMN "validity" TEXT;

-- vários NULL convivem no índice único do Postgres: os antigos ficam sem número
CREATE UNIQUE INDEX "budgets_tenantId_number_key" ON "budgets"("tenantId", "number");

-- Desconto em % no orçamento (docs/orcamentos.md#desconto): só para mostrar; o valor é discountValue
ALTER TABLE "budgets" ADD COLUMN "discountPercent" DECIMAL(5,2);

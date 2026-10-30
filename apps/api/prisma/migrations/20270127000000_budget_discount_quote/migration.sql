-- Orçamento (docs/orcamentos.md): desconto em R$ e o interruptor "Enviar orçamento por mensagem".
-- budgetQuoteEnabled nasce desligado para todos: orçamento só por link até a empresa ligar.
ALTER TABLE "budgets" ADD COLUMN "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "tenant_settings" ADD COLUMN "budgetQuoteEnabled" BOOLEAN NOT NULL DEFAULT false;

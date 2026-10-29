-- Orçamento por mensagem (docs/orcamentos.md#itens-sensíveis): quando os itens vão no texto.
-- Coluna com padrão: a API anterior ignora. Começa desligado (itens nunca no texto); a empresa liga.
ALTER TABLE "tenant_settings" ADD COLUMN "budgetQuoteItems" TEXT NOT NULL DEFAULT 'link';

-- Ligações silenciadas por pessoa e por número (docs/ligacoes.md#silenciar-por-número).
-- Aditiva: coluna com padrão vazio = todo mundo segue recebendo o aviso como antes.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mutedCallNumberIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

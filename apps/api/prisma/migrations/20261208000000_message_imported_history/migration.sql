-- Mensagens trazidas do histórico do provider (docs/historico-de-mensagens.md)
ALTER TABLE "messages" ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;

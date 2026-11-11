-- Contato isento com "Conversa livre" (docs/contatos-isentos.md#conversa-livre). Coluna nova com default:
-- quem já está na lista continua isento comum.
ALTER TABLE "ignored_contacts" ADD COLUMN "freeChat" BOOLEAN NOT NULL DEFAULT false;

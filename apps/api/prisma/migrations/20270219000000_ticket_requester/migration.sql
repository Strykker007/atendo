-- Reclamante do ticket e aviso no WhatsApp (docs/tickets.md#reclamante). Aditiva: colunas
-- opcionais/com padrão; a API anterior ignora e continua igual.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "requesterContactId" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "notifyRequester" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "tickets_requesterContactId_idx" ON "tickets"("requesterContactId");
DO $$ BEGIN
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requesterContactId_fkey" FOREIGN KEY ("requesterContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tickets já abertos de uma conversa: o contato dela vira o reclamante. Sem aviso retroativo
-- (notifyRequester = false nos antigos; só os novos avisam por padrão).
UPDATE "tickets" t SET "requesterContactId" = c."contactId", "notifyRequester" = false
FROM "conversations" c WHERE c."id" = t."conversationId" AND t."requesterContactId" IS NULL;

ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "ticketOpenedMessage" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "ticketClosedMessage" TEXT;

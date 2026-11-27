-- Troca do número de envio na mesma conversa (docs/troca-de-numero.md). Aditiva: colunas
-- opcionais/com padrão, um índice único que só vale para linhas com canal (nulo não conflita) e
-- um valor novo de enum. Conversa que nunca trocou fica exatamente como antes.
ALTER TYPE "ConversationEventType" ADD VALUE IF NOT EXISTS 'channel_changed';

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "channelNumberId" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "channelHistory" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "channelChangedAt" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "channelLastInboundAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_contactId_channelNumberId_key" ON "conversations"("contactId", "channelNumberId");

DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channelNumberId_fkey" FOREIGN KEY ("channelNumberId") REFERENCES "whatsapp_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Permissão nova `conversations.switch_number` nos perfis padrão: Administrador sempre (não
-- existia, ninguém tirou); Gerente e Atendente só os não editados (o editado é escolha do cliente)
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['conversations.switch_number']::TEXT[]))
WHERE "isSystem" = true AND ("systemRole" = 'tenant_admin' OR ("customized" = false AND "systemRole" IN ('manager', 'agent')));

-- Número por onde cada mensagem entrou/saiu. O worker envia por este número, não pelo que a
-- conversa tiver no momento — o canal mostrado ao atendente é o que dispara.
ALTER TABLE "messages" ADD COLUMN "numberId" TEXT;

-- Histórico: até aqui toda mensagem saiu/entrou pelo número da própria conversa
UPDATE "messages" m SET "numberId" = c."numberId"
FROM "conversations" c
WHERE m."conversationId" = c."id" AND m."internal" = false;

CREATE INDEX "messages_numberId_idx" ON "messages"("numberId");

ALTER TABLE "messages" ADD CONSTRAINT "messages_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "whatsapp_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

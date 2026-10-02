-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "awaitingSince" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "conversations_tenantId_status_awaitingSince_idx" ON "conversations"("tenantId", "status", "awaitingSince");


-- Preenche o que já existe: conversa aberta cuja última mensagem veio do contato está sem
-- resposta desde aquele momento. Sem isto, toda a fila atual apareceria como "respondida" e a
-- ordenação por espera nasceria mentindo.
UPDATE "conversations"
   SET "awaitingSince" = "lastInboundAt"
 WHERE "lastInboundAt" IS NOT NULL
   AND ("lastMessageAt" IS NULL OR "lastInboundAt" >= "lastMessageAt")
   AND "status" <> 'closed';

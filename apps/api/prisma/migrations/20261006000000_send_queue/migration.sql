-- Fila de envio: ordem por conversa, expiração, idempotência e limites por conexão. Ver docs/envio.md.
ALTER TABLE "messages" ADD COLUMN "queueSeq" BIGSERIAL NOT NULL;
ALTER TABLE "messages" ADD COLUMN "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "messages" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "messages_conversationId_idempotencyKey_key" ON "messages"("conversationId", "idempotencyKey");
CREATE INDEX "messages_conversationId_status_queueSeq_idx" ON "messages"("conversationId", "status", "queueSeq");

ALTER TABLE "whatsapp_numbers" ADD COLUMN "sendLimits" JSONB;

ALTER TABLE "tenant_settings" ADD COLUMN "quickReplyDelaySec" INTEGER NOT NULL DEFAULT 3;

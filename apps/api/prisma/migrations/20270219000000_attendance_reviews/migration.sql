-- Feedback de atendimento e leitura de notas internas (docs/feedback-de-atendimento.md,
-- docs/notas-internas.md#leitura). Aditiva: duas tabelas novas e uma coluna opcional; a API
-- anterior não as conhece e continua funcionando igual.

ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "reviewSettings" JSONB;

CREATE TABLE IF NOT EXISTS "note_receipts" (
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userName" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "note_receipts_pkey" PRIMARY KEY ("messageId", "userId")
);
CREATE INDEX IF NOT EXISTS "note_receipts_tenantId_userId_readAt_idx" ON "note_receipts"("tenantId", "userId", "readAt");
CREATE INDEX IF NOT EXISTS "note_receipts_conversationId_userId_idx" ON "note_receipts"("conversationId", "userId");
DO $$ BEGIN
  ALTER TABLE "note_receipts" ADD CONSTRAINT "note_receipts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "attendance_reviews" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "closeEventId" TEXT,
  "windowStart" TIMESTAMP(3),
  "windowEnd" TIMESTAMP(3),
  "agentId" TEXT,
  "agentName" TEXT NOT NULL,
  "reviewerId" TEXT,
  "reviewerName" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "messageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "requiresAck" BOOLEAN NOT NULL DEFAULT true,
  "blocksClaim" BOOLEAN NOT NULL DEFAULT false,
  "deadlineMinutes" INTEGER,
  "onlineMinutes" INTEGER NOT NULL DEFAULT 0,
  "seenAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "agentReply" TEXT,
  "repliedAt" TIMESTAMP(3),
  "overdueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "attendance_reviews_tenantId_agentId_acknowledgedAt_idx" ON "attendance_reviews"("tenantId", "agentId", "acknowledgedAt");
CREATE INDEX IF NOT EXISTS "attendance_reviews_tenantId_createdAt_idx" ON "attendance_reviews"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "attendance_reviews_closeEventId_idx" ON "attendance_reviews"("closeEventId");
DO $$ BEGIN
  ALTER TABLE "attendance_reviews" ADD CONSTRAINT "attendance_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "attendance_reviews" ADD CONSTRAINT "attendance_reviews_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Permissão nova `reviews.manage` nos perfis padrão de Administrador e Gerente que o cliente não
-- editou (o editado é escolha dele). Ver docs/18-perfis-de-acesso.md.
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['reviews.manage']::TEXT[]))
WHERE "isSystem" = true AND "customized" = false AND "systemRole" IN ('tenant_admin', 'manager');

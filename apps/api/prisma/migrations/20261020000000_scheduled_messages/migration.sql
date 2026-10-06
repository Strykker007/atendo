-- Mensagens agendadas pelo atendente (docs/agendamento-de-mensagens.md).
-- CreateEnum
CREATE TYPE "ScheduledMessageStatus" AS ENUM ('pending', 'sent', 'cancelled', 'failed');

-- CreateTable
CREATE TABLE "scheduled_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaKey" TEXT,
    "mediaType" TEXT,
    "mediaName" TEXT,
    "mediaMime" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_messages_status_scheduledFor_idx" ON "scheduled_messages"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "scheduled_messages_conversationId_status_idx" ON "scheduled_messages"("conversationId", "status");

-- CreateIndex
CREATE INDEX "scheduled_messages_tenantId_status_idx" ON "scheduled_messages"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permissão nova só no perfil padrão "Administrador" não editado: agendar é vendido à parte,
-- Gerente e Atendente ganham quando alguém marcar no perfil.
UPDATE "access_profiles"
SET "permissions" = array_append("permissions", 'conversations.schedule_message')
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" = 'Administrador'
  AND NOT ('conversations.schedule_message' = ANY("permissions"));

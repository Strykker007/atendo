-- Chat interno: resposta a mensagem, avisos do sistema e grupo apagado (docs/chat-interno.md)
-- AlterTable
ALTER TABLE "internal_chats" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "internal_messages" ADD COLUMN     "replyToId" TEXT,
ADD COLUMN     "system" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "internal_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;


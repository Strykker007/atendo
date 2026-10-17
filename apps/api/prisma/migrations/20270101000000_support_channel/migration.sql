-- Canal de suporte do sistema no chat interno (docs/chat-interno.md#suporte)
-- AlterTable
ALTER TABLE "internal_chats" ADD COLUMN     "isSupport" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "internal_messages" ADD COLUMN     "fromSupport" BOOLEAN NOT NULL DEFAULT false;


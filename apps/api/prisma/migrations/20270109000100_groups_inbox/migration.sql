-- Grupos nas conversas (docs/grupos.md#grupos-nas-conversas). Só colunas novas com default:
-- a API anterior ignora tudo e continua descartando grupo no webhook.

-- AlterTable
ALTER TABLE "whatsapp_groups" ADD COLUMN "inbox" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "inboxAt" TIMESTAMP(3),
ADD COLUMN "inboxById" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "isGroup" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "senderName" TEXT,
ADD COLUMN "senderPhone" TEXT;

-- CreateIndex
CREATE INDEX "whatsapp_groups_numberId_inbox_idx" ON "whatsapp_groups"("numberId", "inbox");

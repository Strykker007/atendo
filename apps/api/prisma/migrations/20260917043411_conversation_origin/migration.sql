-- CreateEnum
CREATE TYPE "ConversationOrigin" AS ENUM ('organic', 'ad', 'post', 'link');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "origin" "ConversationOrigin" NOT NULL DEFAULT 'organic',
ADD COLUMN     "originData" JSONB;

-- CreateIndex
CREATE INDEX "conversations_tenantId_origin_idx" ON "conversations"("tenantId", "origin");

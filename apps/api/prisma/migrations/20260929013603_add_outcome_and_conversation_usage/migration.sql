-- CreateEnum
CREATE TYPE "ConversationOutcome" AS ENUM ('none', 'won', 'lost');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "outcome" "ConversationOutcome" NOT NULL DEFAULT 'none',
ADD COLUMN     "outcomeAt" TIMESTAMP(3),
ADD COLUMN     "outcomeById" TEXT,
ADD COLUMN     "outcomeReason" TEXT,
ADD COLUMN     "outcomeValue" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "usage_counters" ADD COLUMN     "conversations" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "conversation_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_usage_tenantId_startedAt_idx" ON "conversation_usage"("tenantId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_usage_numberId_contactId_startedAt_key" ON "conversation_usage"("numberId", "contactId", "startedAt");


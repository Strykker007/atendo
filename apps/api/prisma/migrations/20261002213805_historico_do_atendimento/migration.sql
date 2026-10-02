-- CreateEnum
CREATE TYPE "ConversationEventType" AS ENUM ('claimed', 'transferred', 'released', 'closed', 'reopened');

-- CreateTable
CREATE TABLE "conversation_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" "ConversationEventType" NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "fromStatus" "ConversationStatus",
    "toStatus" "ConversationStatus",
    "outcome" "ConversationOutcome",
    "outcomeValue" DECIMAL(12,2),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_events_conversationId_createdAt_idx" ON "conversation_events"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_events_tenantId_type_createdAt_idx" ON "conversation_events"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_events_tenantId_actorId_createdAt_idx" ON "conversation_events"("tenantId", "actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


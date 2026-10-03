-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "quotedMessageId" TEXT;

-- CreateIndex
CREATE INDEX "messages_quotedMessageId_idx" ON "messages"("quotedMessageId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_quotedMessageId_fkey" FOREIGN KEY ("quotedMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

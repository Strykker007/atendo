-- Cache do resumo por IA: reaproveitado enquanto não chega mensagem nova
ALTER TABLE "conversations" ADD COLUMN "summaryCache" TEXT,
ADD COLUMN "summaryLastMessageId" TEXT,
ADD COLUMN "summaryUpdatedAt" TIMESTAMP(3);

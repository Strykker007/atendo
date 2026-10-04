-- Pausar o robô só numa conversa (tarefa 1.5). `botPausedUntil` nulo com `botPausedAt`
-- preenchido = pausado até alguém retomar.
ALTER TYPE "ConversationEventType" ADD VALUE 'bot_paused';
ALTER TYPE "ConversationEventType" ADD VALUE 'bot_resumed';

ALTER TABLE "conversations" ADD COLUMN "botPausedAt" TIMESTAMP(3),
ADD COLUMN "botPausedById" TEXT,
ADD COLUMN "botPausedUntil" TIMESTAMP(3);

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_botPausedById_fkey" FOREIGN KEY ("botPausedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

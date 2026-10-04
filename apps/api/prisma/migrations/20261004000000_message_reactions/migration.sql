-- Reações (emoji) a mensagens: ficam na mensagem reagida, não viram mensagem nova
ALTER TABLE "messages" ADD COLUMN "reactions" JSONB;

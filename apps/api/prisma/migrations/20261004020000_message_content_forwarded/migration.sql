-- Mensagens interativas (botões/lista/template) ganham tipo próprio em vez de cair em "unknown"
ALTER TYPE "MessageType" ADD VALUE 'interactive';

-- Estrutura de botões/lista/localização/contatos e marca de encaminhada
ALTER TABLE "messages" ADD COLUMN "content" JSONB;
ALTER TABLE "messages" ADD COLUMN "forwarded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "messages" ADD COLUMN "forwardingScore" INTEGER;

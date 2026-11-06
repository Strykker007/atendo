-- Ticket aberto a partir de uma conversa: a mensagem de origem e o retrato do contexto (docs/tickets.md)
ALTER TABLE "tickets" ADD COLUMN "messageId" TEXT;
ALTER TABLE "tickets" ADD COLUMN "context" JSONB;

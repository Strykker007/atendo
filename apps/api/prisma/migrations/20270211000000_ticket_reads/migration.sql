-- Não lidos dos tickets (docs/tickets.md#não-lidos). Ticket que diz respeito à pessoa e mudou depois
-- da última vez que ela abriu conta como não lido (só os ativos).
CREATE TABLE "ticket_reads" (
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_reads_pkey" PRIMARY KEY ("ticketId","userId")
);
CREATE INDEX "ticket_reads_userId_idx" ON "ticket_reads"("userId");
ALTER TABLE "ticket_reads" ADD CONSTRAINT "ticket_reads_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_reads" ADD CONSTRAINT "ticket_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Quem já está nos tickets começa com tudo lido: o deploy não acende o menu de todo mundo com o passado.
INSERT INTO "ticket_reads" ("ticketId", "userId", "seenAt") SELECT "ticketId", "userId", CURRENT_TIMESTAMP FROM "ticket_participants" ON CONFLICT DO NOTHING;

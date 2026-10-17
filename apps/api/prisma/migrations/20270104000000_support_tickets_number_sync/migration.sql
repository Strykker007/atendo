-- Fila de suporte (docs/chat-interno.md#fila-de-suporte) e aviso de sincronização ao reconectar
-- um número (docs/04-providers-whatsapp.md#sincronização)
ALTER TABLE "whatsapp_numbers" ADD COLUMN "syncStartedAt" TIMESTAMP(3);

CREATE TYPE "SupportTicketStatus" AS ENUM ('open', 'in_progress', 'resolved');

CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");
CREATE INDEX "support_tickets_status_openedAt_idx" ON "support_tickets"("status", "openedAt");
CREATE INDEX "support_tickets_chatId_status_idx" ON "support_tickets"("chatId", "status");
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "internal_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Canais que já têm mensagem do cliente sem resposta do suporte depois dela entram na fila.
INSERT INTO "support_tickets" ("id", "tenantId", "chatId", "status", "openedAt", "updatedAt")
SELECT gen_random_uuid()::text, c."tenantId", c."id", 'open', m.first_unanswered, CURRENT_TIMESTAMP
FROM "internal_chats" c
JOIN LATERAL (
  SELECT min(x."createdAt") AS first_unanswered
  FROM "internal_messages" x
  WHERE x."chatId" = c."id" AND NOT x."fromSupport" AND NOT x."system"
    AND x."createdAt" > COALESCE((SELECT max(y."createdAt") FROM "internal_messages" y WHERE y."chatId" = c."id" AND y."fromSupport"), 'epoch')
) m ON m.first_unanswered IS NOT NULL
WHERE c."isSupport";

-- No máximo um atendimento ativo por canal (duas mensagens simultâneas do cliente não abrem dois)
CREATE UNIQUE INDEX "support_tickets_one_active_per_chat" ON "support_tickets"("chatId") WHERE "status" <> 'resolved';

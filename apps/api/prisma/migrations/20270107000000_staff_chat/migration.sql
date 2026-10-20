-- Chat da equipe do suporte (docs/chat-interno.md#equipe-do-suporte): entre super_admins,
-- fora de qualquer cliente. Só tabelas novas — nada muda em internal_chats.

CREATE TABLE "staff_chats" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_chats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_chat_members" (
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_chat_members_pkey" PRIMARY KEY ("chatId","userId")
);

CREATE TABLE "staff_messages" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "replyToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_chats_key_key" ON "staff_chats"("key");
CREATE INDEX "staff_chat_members_userId_idx" ON "staff_chat_members"("userId");
CREATE INDEX "staff_messages_chatId_createdAt_idx" ON "staff_messages"("chatId", "createdAt");

ALTER TABLE "staff_chat_members" ADD CONSTRAINT "staff_chat_members_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "staff_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_chat_members" ADD CONSTRAINT "staff_chat_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "staff_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "staff_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

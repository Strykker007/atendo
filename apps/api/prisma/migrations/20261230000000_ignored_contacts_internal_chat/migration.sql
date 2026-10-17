-- Contatos isentos de ticket (docs/contatos-isentos.md) + chat interno da equipe (docs/chat-interno.md)
-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "ticketExempt" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ignored_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ignored_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_chats" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "directKey" TEXT,
    "createdById" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_chat_members" (
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_chat_members_pkey" PRIMARY KEY ("chatId","userId")
);

-- CreateTable
CREATE TABLE "internal_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ignored_contacts_tenantId_phone_key" ON "ignored_contacts"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "internal_chats_tenantId_lastMessageAt_idx" ON "internal_chats"("tenantId", "lastMessageAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "internal_chats_tenantId_directKey_key" ON "internal_chats"("tenantId", "directKey");

-- CreateIndex
CREATE INDEX "internal_chat_members_userId_idx" ON "internal_chat_members"("userId");

-- CreateIndex
CREATE INDEX "internal_messages_chatId_createdAt_idx" ON "internal_messages"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "internal_messages_tenantId_createdAt_idx" ON "internal_messages"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "conversations_tenantId_ticketExempt_lastMessageAt_idx" ON "conversations"("tenantId", "ticketExempt", "lastMessageAt" DESC);

-- AddForeignKey
ALTER TABLE "ignored_contacts" ADD CONSTRAINT "ignored_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_chats" ADD CONSTRAINT "internal_chats_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_chat_members" ADD CONSTRAINT "internal_chat_members_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "internal_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_chat_members" ADD CONSTRAINT "internal_chat_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "internal_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Nova permissão (auditar o chat interno) no perfil padrão de Administrador que o cliente não
-- editou (o editado é escolha dele). Gerente fica sem. Ver docs/18-perfis-de-acesso.md.
UPDATE "access_profiles"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['internal_chat.audit']::TEXT[])
)
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" = 'Administrador';

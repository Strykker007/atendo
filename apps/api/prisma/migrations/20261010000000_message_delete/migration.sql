-- Apagar mensagem / limpar histórico com registro de auditoria. Ver docs/apagar-mensagens.md.
ALTER TYPE "ConversationEventType" ADD VALUE 'message_deleted';
ALTER TYPE "ConversationEventType" ADD VALUE 'history_cleared';

ALTER TABLE "messages"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "deletedByName" TEXT,
  ADD COLUMN "deletedForEveryone" BOOLEAN NOT NULL DEFAULT false;

-- Permissões novas nos perfis padrão "Gerente" e "Administrador" que o cliente não editou
-- (mesma regra de agent_internal_note: perfil editado é escolha do cliente).
UPDATE "access_profiles"
SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY['conversations.delete_message', 'conversations.delete_chat', 'conversations.view_deleted']) AS p
  WHERE NOT (p = ANY("permissions"))
)
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" IN ('Gerente', 'Administrador');

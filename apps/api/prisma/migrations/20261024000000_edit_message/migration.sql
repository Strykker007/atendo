-- Editar mensagem enviada (docs/editar-mensagens.md).
ALTER TABLE "messages" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TYPE "ConversationEventType" ADD VALUE IF NOT EXISTS 'message_edited';

-- Permissão nova ligada nos três perfis padrão não editados: existe para poder ser RETIRADA.
-- Perfil que o cliente editou é escolha dele (docs/18-perfis-de-acesso.md) — liga na tela.
UPDATE "access_profiles"
SET "permissions" = array_append("permissions", 'conversations.edit_message')
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" IN ('Administrador', 'Gerente', 'Atendente')
  AND NOT ('conversations.edit_message' = ANY("permissions"));

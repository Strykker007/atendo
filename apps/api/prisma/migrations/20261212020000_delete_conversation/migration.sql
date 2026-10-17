-- Excluir conversa (docs/apagar-mensagens.md#excluir-conversa): permissão nova só no
-- "Administrador" padrão que o cliente não editou (perfil editado é escolha do cliente)
UPDATE "access_profiles"
SET "permissions" = "permissions" || ARRAY['conversations.delete_conversation']
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" = 'Administrador'
  AND NOT ('conversations.delete_conversation' = ANY("permissions"));

-- O ledger de cobrança não pode sumir com a mensagem: excluir uma conversa apagava as linhas de
-- message_usage em cascata. Agora a linha fica, só sem o vínculo (igual a ai_usage).
ALTER TABLE "message_usage" ALTER COLUMN "messageId" DROP NOT NULL;
ALTER TABLE "message_usage" DROP CONSTRAINT "message_usage_messageId_fkey";
ALTER TABLE "message_usage" ADD CONSTRAINT "message_usage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

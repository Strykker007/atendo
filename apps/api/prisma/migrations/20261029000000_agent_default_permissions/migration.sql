-- Atendente passa a transferir o atendimento dos outros, agendar mensagem e conectar números.
-- Só no perfil padrão que o cliente não editou — o editado é escolha dele. Ver docs/18-perfis-de-acesso.md.
UPDATE "access_profiles"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['conversations.transfer_any', 'conversations.schedule_message', 'numbers.manage']::TEXT[])
)
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" = 'Atendente';

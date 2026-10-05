-- Atendente passa a escrever nota interna (passagem de bastão). Só no perfil padrão que o
-- cliente não editou — o editado é escolha dele. Ver docs/18-perfis-de-acesso.md.
UPDATE "access_profiles"
SET "permissions" = array_append("permissions", 'conversations.internal_note')
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" = 'Atendente'
  AND NOT ('conversations.internal_note' = ANY("permissions"));

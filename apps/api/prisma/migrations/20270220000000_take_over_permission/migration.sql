-- Permissão nova `conversations.take_over` (assumir/responder atendimento de outra pessoa) no
-- perfil padrão de Administrador de todo cliente — inclusive o já editado: a permissão não existia,
-- então ninguém a tirou; acrescentar não desfaz escolha nenhuma. Os demais perfis recebem pela
-- tela de Perfis de acesso. Só dados, aditivo. Ver docs/18-perfis-de-acesso.md.
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['conversations.take_over']::TEXT[]))
WHERE "isSystem" = true AND "systemRole" = 'tenant_admin';

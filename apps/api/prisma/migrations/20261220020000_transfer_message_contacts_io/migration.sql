-- Mensagem automática ao cliente na transferência do atendimento (docs/08-frontend.md#transferência)
ALTER TABLE "tenant_settings" ADD COLUMN "transferMessageEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN "transferMessageText" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN "departmentTransferMessageText" TEXT;

-- Importar/exportar contatos: entra nos perfis padrão de Administrador e Gerente que o cliente
-- não editou (o editado é escolha dele) — docs/18-perfis-de-acesso.md
UPDATE "access_profiles"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['contacts.import_export']::TEXT[])
)
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" IN ('Administrador', 'Gerente');

-- Variáveis da empresa (docs/variaveis.md).
-- CreateTable
CREATE TABLE "global_variables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_variables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "global_variables_tenantId_key_key" ON "global_variables"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "global_variables" ADD CONSTRAINT "global_variables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permissão nova nos perfis padrão Administrador e Gerente não editados (Atendente não ganha).
UPDATE "access_profiles"
SET "permissions" = array_append("permissions", 'variables.manage')
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" IN ('Administrador', 'Gerente')
  AND NOT ('variables.manage' = ANY("permissions"));

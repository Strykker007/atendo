-- Encerramento interno (fora dos relatórios) + motivo que exige tag + auditoria
-- (docs/06-modelo-de-dados.md#encerramento-interno).
ALTER TABLE "close_reasons" ADD COLUMN "ignoreInReports" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "close_reasons" ADD COLUMN "requiresTag" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversation_events" ADD COLUMN "ignoreInReports" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "contactId" TEXT,
    "contactName" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_tenantId_action_createdAt_idx" ON "audit_logs"("tenantId", "action", "createdAt" DESC);
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nova permissão nos perfis padrão de Administrador e Gerente que o cliente não editou
-- (o editado é escolha dele). Ver docs/18-perfis-de-acesso.md.
UPDATE "access_profiles"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest("permissions" || ARRAY['conversations.close_internal']::TEXT[])
)
WHERE "isSystem" = true
  AND "customized" = false
  AND "name" IN ('Administrador', 'Gerente');

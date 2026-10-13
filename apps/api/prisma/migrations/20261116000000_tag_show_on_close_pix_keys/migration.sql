-- Tags do encerramento: só as marcadas aparecem no "Comprou / Não comprou" (docs/06-modelo-de-dados.md).
ALTER TABLE "tags" ADD COLUMN "showOnClose" BOOLEAN NOT NULL DEFAULT false;

-- Quem já usava: ficam marcadas as que não são etapa do Kanban (os antigos motivos de perda
-- viraram tags assim) e as que já foram escolhidas em algum encerramento.
UPDATE "tags" t SET "showOnClose" = true
WHERE t."isKanban" = false
   OR EXISTS (SELECT 1 FROM "conversation_events" e WHERE e."tenantId" = t."tenantId" AND e."type" = 'closed' AND t."id" = ANY(e."tagIds"));

-- Chaves Pix da empresa (enviadas como cartão com "Copiar chave Pix")
CREATE TABLE "pix_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pix_keys_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pix_keys_tenantId_idx" ON "pix_keys"("tenantId");
ALTER TABLE "pix_keys" ADD CONSTRAINT "pix_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

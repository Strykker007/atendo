-- Fluxos que aparecem no modal de encerramento (docs/fluxos.md#fluxos-de-encerramento)
ALTER TABLE "flows" ADD COLUMN "showOnClosing" BOOLEAN NOT NULL DEFAULT false;

-- Já entram marcados os fluxos padrão de encerramento (Configurações → Fluxos padrão).
UPDATE "flows" f SET "showOnClosing" = true
WHERE EXISTS (
  SELECT 1 FROM "tenant_settings" s
  WHERE s."tenantId" = f."tenantId"
    AND f."id" IN (s."onCloseFlowId", s."wonFlowId", s."lostFlowId")
);

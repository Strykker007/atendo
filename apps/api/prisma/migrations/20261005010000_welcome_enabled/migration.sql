-- Chave das mensagens de boas-vindas (tarefa 2, docs/horarios.md → Boas-vindas).
-- Quem já tem "Fluxo de boas-vindas" ativo começa com as mensagens desligadas, para o contato
-- não receber dois cumprimentos; a tela avisa quando os dois estiverem ligados.
ALTER TABLE "tenant_settings" ADD COLUMN "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "tenant_settings" s SET "welcomeEnabled" = false
WHERE s."welcomeFlowId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "flows" f WHERE f."id" = s."welcomeFlowId" AND f."isActive" = true);

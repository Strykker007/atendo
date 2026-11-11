-- Número reservado, números padrão por pessoa e devolução de atendimentos de quem saiu.
-- Só colunas novas com default: a versão anterior da API continua funcionando.
ALTER TABLE "whatsapp_numbers" ADD COLUMN "reserved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "defaultNumberIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "tenant_settings" ADD COLUMN "releaseAwayEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN "releaseAwayMinutes" INTEGER NOT NULL DEFAULT 30;

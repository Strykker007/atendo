-- cor de cada motivo de perda no botão do encerramento
ALTER TABLE "tenant_settings" ADD COLUMN "lossReasonColors" JSONB NOT NULL DEFAULT '{}';

-- Encerramento sem venda (atendimento: condomínio, suporte…) e assinatura obrigatória do atendente
ALTER TABLE "tenant_settings" ADD COLUMN "salesEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tenant_settings" ADD COLUMN "requireSignature" BOOLEAN NOT NULL DEFAULT false;

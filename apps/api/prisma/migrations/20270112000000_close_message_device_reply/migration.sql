-- Aviso de encerramento ao cliente (docs/08-frontend.md#aviso-de-encerramento) e resposta pelo celular
-- em conversa sem dono (docs/06-modelo-de-dados.md). Só acrescenta colunas opcionais.
ALTER TABLE "tenant_settings" ADD COLUMN "closeMessageEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN "closeMessageText" TEXT;
ALTER TABLE "conversations" ADD COLUMN "deviceReplyAt" TIMESTAMP(3);

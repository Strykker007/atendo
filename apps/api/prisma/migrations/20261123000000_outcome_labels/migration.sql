-- Nome dos resultados do encerramento por empresa (Configurações → Atendimento → Encerramento).
ALTER TABLE "tenant_settings" ADD COLUMN "wonLabel" TEXT NOT NULL DEFAULT 'Comprou';
ALTER TABLE "tenant_settings" ADD COLUMN "lostLabel" TEXT NOT NULL DEFAULT 'Não comprou';

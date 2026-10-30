-- Desativar cliente de verdade (docs/desativar-cliente.md). Aditiva: colunas opcionais.
ALTER TABLE "tenants" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "whatsapp_numbers" ADD COLUMN "suspendedAt" TIMESTAMP(3);

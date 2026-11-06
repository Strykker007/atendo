-- Redistribuição automática de conversas órfãs. Aditiva: colunas com default, desligada para todos.
ALTER TABLE "tenant_settings" ADD COLUMN "autoReassignWaiting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN "autoReassignAssigned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN "autoReassignBaseMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "tenant_settings" ADD COLUMN "autoReassignMaxMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "tenant_settings" ADD COLUMN "autoReassignMaxTimes" INTEGER NOT NULL DEFAULT 2;

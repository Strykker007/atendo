-- Queda forçada pelo WhatsApp (401 device_removed) e pausa de reconexão (docs/04-providers-whatsapp.md)
ALTER TABLE "whatsapp_numbers" ADD COLUMN "waRemovedAt" TIMESTAMP(3);
ALTER TABLE "whatsapp_numbers" ADD COLUMN "waRemovedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "whatsapp_numbers" ADD COLUMN "reconnectBlockedUntil" TIMESTAMP(3);

-- Aquecimento por sessão (QR lido) e número sem WhatsApp (docs/envio.md)
ALTER TABLE "whatsapp_numbers" ADD COLUMN "sessionStartedAt" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN "waInvalidAt" TIMESTAMP(3);

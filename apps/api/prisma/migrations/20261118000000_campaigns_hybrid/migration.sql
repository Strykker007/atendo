-- Transmissão híbrida: QR Code com travas + API oficial (docs/envio.md#transmissão).
ALTER TABLE "whatsapp_numbers" ADD COLUMN "campaignDailyLimit" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "campaigns" ADD COLUMN "audience" JSONB;
ALTER TABLE "campaigns" ADD COLUMN "riskAcceptedAt" TIMESTAMP(3);
ALTER TABLE "campaigns" ADD COLUMN "riskAcceptedById" TEXT;
ALTER TABLE "campaigns" ADD COLUMN "pauseReason" TEXT;

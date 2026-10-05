-- Teto diário passa a ser opcional: padrão 0 (sem teto). Quem estava no padrão antigo (1000)
-- vira sem teto; valores personalizados ficam como estão.
ALTER TABLE "whatsapp_numbers" ALTER COLUMN "sendDailyLimit" SET DEFAULT 0;
UPDATE "whatsapp_numbers" SET "sendDailyLimit" = 0 WHERE "sendDailyLimit" = 1000;

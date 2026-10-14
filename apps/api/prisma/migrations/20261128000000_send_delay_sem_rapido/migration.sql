-- Intervalo "Rápido" (1–2s) saiu por risco de banimento: o mínimo no QR Code passa a ser 3s.
-- Quem estava nele (era o padrão da Evolution) vai para o Moderado (3–5s); QR em "Imediato" também.
UPDATE "whatsapp_numbers" SET "sendDelay" = 'moderate' WHERE "sendDelay" = 'fast';
UPDATE "whatsapp_numbers" SET "sendDelay" = 'moderate' WHERE "sendDelay" = 'instant' AND "provider" = 'evolution';
ALTER TABLE "whatsapp_numbers" ALTER COLUMN "sendDelay" SET DEFAULT 'moderate';

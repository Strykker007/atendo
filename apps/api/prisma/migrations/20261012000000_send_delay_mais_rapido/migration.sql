-- Envio mais rápido: o padrão antigo (7–25s entre envios do número) segurava o atendimento.
-- Novo padrão = Rápido (agora 1–2s; Curto passou a 3–4s). Quem estava no antigo padrão migra; escolhas manuais
-- (médio/longo) ficam. Número da API oficial não precisa de ritmo: vai para Imediato.
ALTER TABLE "whatsapp_numbers" ALTER COLUMN "sendDelay" SET DEFAULT 'fast';
UPDATE "whatsapp_numbers" SET "sendDelay" = 'instant' WHERE "provider" = 'meta' AND "sendDelay" IN ('short', 'fast');
UPDATE "whatsapp_numbers" SET "sendDelay" = 'fast' WHERE "provider" <> 'meta' AND "sendDelay" = 'short';

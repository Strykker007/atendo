-- Teto diário e aquecimento saíram do produto: todo número fica sem limite de envios por dia.
-- As colunas continuam (o código ainda lê; 0 = sem teto, sem warmupStartedAt = sem aquecimento).
UPDATE "whatsapp_numbers" SET "sendDailyLimit" = 0, "warmupStartedAt" = NULL;

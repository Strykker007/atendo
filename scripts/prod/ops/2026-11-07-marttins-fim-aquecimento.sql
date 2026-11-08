-- Drogaria Marttins (Cel 0192): encerra o aquecimento reaberto pela queda de 07/11 08:22.
-- sessionStartedAt 8 dias atrás => warmupPhase() devolve null (passa das 168 h).
UPDATE whatsapp_numbers SET "sessionStartedAt" = now() - interval '8 days' WHERE id = '5d37b8ad-11f7-4654-9598-a8ad5fb0fe8f';

-- Intervalo entre envios "Moderado": 3–5s sorteado a cada envio (docs/04-providers-whatsapp.md).
ALTER TYPE "SendDelayProfile" ADD VALUE IF NOT EXISTS 'moderate' AFTER 'short';

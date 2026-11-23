-- Transcrição de áudio sob demanda (docs/transcricao-de-audio.md). Aditiva: coluna opcional e
-- valor novo de enum; a API anterior continua igual.
ALTER TYPE "AiTaskKind" ADD VALUE IF NOT EXISTS 'transcribe';
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "transcript" TEXT;

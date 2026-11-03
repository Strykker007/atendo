-- Ligação no WhatsApp registrada na conversa (docs/ligacoes.md). Aditiva: só um valor novo no enum.
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'call';

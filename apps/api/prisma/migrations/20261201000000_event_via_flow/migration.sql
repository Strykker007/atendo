-- encerramento com resultado feito por fluxo (Encerrar conversa com Comprou/Não comprou)
ALTER TABLE "conversation_events" ADD COLUMN "viaFlow" TEXT;

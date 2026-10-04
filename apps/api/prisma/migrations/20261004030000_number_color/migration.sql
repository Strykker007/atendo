-- Cor do canal (número de WhatsApp), usada no selo da lista de conversas e no cabeçalho do chat
ALTER TABLE "whatsapp_numbers" ADD COLUMN "color" TEXT NOT NULL DEFAULT '#64748b';

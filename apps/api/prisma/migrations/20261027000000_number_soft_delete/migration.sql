-- Excluir número passa a arquivar: conversas e histórico ficam e voltam ao recadastrar o mesmo telefone
ALTER TABLE "whatsapp_numbers" ADD COLUMN "deletedAt" TIMESTAMP(3);

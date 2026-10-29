-- Lembretes da mensalidade (e-mail com o Pix): marca o que já foi enviado em cada cobrança.
-- Aditiva: colunas opcionais, nada muda para as faturas existentes.
ALTER TABLE "invoices" ADD COLUMN "remindedSoonAt" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "remindedDueAt" TIMESTAMP(3);

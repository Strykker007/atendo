-- externalId deixa de ser único global e passa a ser único por número: quando um número nosso
-- fala com outro, o WhatsApp usa o mesmo id na saída de um e na entrada do outro, e a entrada
-- era descartada como duplicata. Aditiva para a API anterior: ela só busca por externalId,
-- que continua indexado.

-- CreateIndex
CREATE UNIQUE INDEX "messages_numberId_externalId_key" ON "messages"("numberId", "externalId");

-- CreateIndex
CREATE INDEX "messages_externalId_idx" ON "messages"("externalId");

-- DropIndex
DROP INDEX "messages_externalId_key";

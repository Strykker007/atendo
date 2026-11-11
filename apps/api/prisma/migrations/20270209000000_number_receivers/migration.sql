-- Quem recebe atendimento automático por número (docs/distribuicao-por-numero.md).
-- Tabela nova: sem linhas, todos que enxergam o número continuam recebendo (comportamento anterior).
CREATE TABLE "number_receivers" (
    "numberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "number_receivers_pkey" PRIMARY KEY ("numberId","userId")
);
CREATE INDEX "number_receivers_userId_idx" ON "number_receivers"("userId");
ALTER TABLE "number_receivers" ADD CONSTRAINT "number_receivers_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "whatsapp_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "number_receivers" ADD CONSTRAINT "number_receivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

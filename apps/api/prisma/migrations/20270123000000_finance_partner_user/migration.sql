-- Sócio do fechamento vinculado à conta do sistema (docs/36-fechamento-financeiro.md). Aditiva: coluna opcional.
ALTER TABLE "finance_partners" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "finance_partners_userId_key" ON "finance_partners"("userId");
ALTER TABLE "finance_partners" ADD CONSTRAINT "finance_partners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

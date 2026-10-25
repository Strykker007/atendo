-- Uma pessoa em várias empresas (docs/multiempresa.md). Aditiva: e-mail passa a aceitar vazio (só
-- vínculo não tem) e o vínculo aponta para o login principal. Nenhuma linha existente muda.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "primaryUserId" TEXT;
CREATE INDEX "users_primaryUserId_idx" ON "users"("primaryUserId");
ALTER TABLE "users" ADD CONSTRAINT "users_primaryUserId_fkey" FOREIGN KEY ("primaryUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

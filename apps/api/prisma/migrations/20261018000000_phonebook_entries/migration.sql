-- Agenda do celular de cada número: nome salvo no aparelho, sem virar contato no painel.
CREATE TABLE "phonebook_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "phonebook_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phonebook_entries_numberId_phone_key" ON "phonebook_entries"("numberId", "phone");
CREATE INDEX "phonebook_entries_tenantId_phone_idx" ON "phonebook_entries"("tenantId", "phone");

ALTER TABLE "phonebook_entries" ADD CONSTRAINT "phonebook_entries_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "whatsapp_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

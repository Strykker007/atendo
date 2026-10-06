-- Campos personalizados da ficha do contato: a empresa define, o atendente preenche.
CREATE TYPE "ContactFieldType" AS ENUM ('text', 'number', 'date', 'select');

CREATE TABLE "contact_fields" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "ContactFieldType" NOT NULL DEFAULT 'text',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_field_values" (
    "contactId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_field_values_pkey" PRIMARY KEY ("contactId","fieldId")
);

CREATE UNIQUE INDEX "contact_fields_tenantId_key_key" ON "contact_fields"("tenantId", "key");
CREATE INDEX "contact_field_values_fieldId_idx" ON "contact_field_values"("fieldId");

ALTER TABLE "contact_fields" ADD CONSTRAINT "contact_fields_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_field_values" ADD CONSTRAINT "contact_field_values_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_field_values" ADD CONSTRAINT "contact_field_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "contact_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

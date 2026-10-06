-- Campos da ficha passam a ser por contato (cada cliente tem os seus), não um cadastro da empresa.
-- Sai o modelo anterior (definição da empresa + valores), que ainda não chegou a produção.
DROP TABLE "contact_field_values";
DROP TABLE "contact_fields";
DROP TYPE "ContactFieldType";

CREATE TYPE "ContactAttributeType" AS ENUM ('text', 'number', 'date');

CREATE TABLE "contact_attributes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "ContactAttributeType" NOT NULL DEFAULT 'text',
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_attributes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_attributes_contactId_idx" ON "contact_attributes"("contactId");
CREATE INDEX "contact_attributes_tenantId_label_idx" ON "contact_attributes"("tenantId", "label");

ALTER TABLE "contact_attributes" ADD CONSTRAINT "contact_attributes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_attributes" ADD CONSTRAINT "contact_attributes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

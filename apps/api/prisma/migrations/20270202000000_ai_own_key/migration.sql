-- Chave de IA do próprio cliente (feature ai_own_key). Aditiva: tabela nova + coluna com default.
ALTER TABLE "ai_usage" ADD COLUMN "ownKey" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ai_credentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "model" TEXT,
    "keyLast4" TEXT NOT NULL,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_credentials_tenantId_key" ON "ai_credentials"("tenantId");

ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

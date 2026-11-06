-- Agente de IA com etapas (docs/agente-ia.md). Aditiva.
ALTER TYPE "AiTaskKind" ADD VALUE IF NOT EXISTS 'flow_agent';

CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "persona" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "rules" TEXT NOT NULL DEFAULT '',
    "knowledge" TEXT NOT NULL DEFAULT '',
    "stages" JSONB NOT NULL DEFAULT '[]',
    "targets" JSONB NOT NULL DEFAULT '{}',
    "maxReplies" INTEGER NOT NULL DEFAULT 20,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agents_tenantId_idx" ON "ai_agents"("tenantId");

ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

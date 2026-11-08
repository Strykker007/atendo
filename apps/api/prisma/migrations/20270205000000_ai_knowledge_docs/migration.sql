-- Documentos do agente de IA (docs/agente-ia.md#documentos). Só acrescenta: tabelas novas e um valor de enum.
ALTER TYPE "AiTaskKind" ADD VALUE 'knowledge';

CREATE TABLE "ai_knowledge_docs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "chars" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_knowledge_docs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_knowledge_chunks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "heading" TEXT,
    "text" TEXT NOT NULL,
    "search" TEXT NOT NULL,
    "tsv" tsvector,
    "embedding" BYTEA,
    "embedModel" TEXT,

    CONSTRAINT "ai_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_knowledge_docs_tenantId_agentId_idx" ON "ai_knowledge_docs"("tenantId", "agentId");
CREATE UNIQUE INDEX "ai_knowledge_chunks_docId_position_key" ON "ai_knowledge_chunks"("docId", "position");
CREATE INDEX "ai_knowledge_chunks_agentId_idx" ON "ai_knowledge_chunks"("agentId");
CREATE INDEX "ai_knowledge_chunks_tsv_idx" ON "ai_knowledge_chunks" USING GIN ("tsv");

ALTER TABLE "ai_knowledge_docs" ADD CONSTRAINT "ai_knowledge_docs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_docId_fkey" FOREIGN KEY ("docId") REFERENCES "ai_knowledge_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

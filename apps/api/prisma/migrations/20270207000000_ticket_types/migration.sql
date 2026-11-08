-- Tipos de ticket com campos próprios e origem do ticket (docs/tickets.md#tipos-de-ticket).
-- Só acrescenta: tabela nova e colunas opcionais/com default em tickets.
CREATE TABLE "ticket_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "departmentId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "dueDays" INTEGER,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ticket_types_tenantId_name_key" ON "ticket_types"("tenantId", "name");

ALTER TABLE "tickets" ADD COLUMN "typeId" TEXT;
ALTER TABLE "tickets" ADD COLUMN "fields" JSONB;
ALTER TABLE "tickets" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'panel';
-- já existentes: os ligados a uma conversa nasceram dela
UPDATE "tickets" SET "source" = 'conversation' WHERE "conversationId" IS NOT NULL;
CREATE INDEX "tickets_tenantId_typeId_idx" ON "tickets"("tenantId", "typeId");

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ticket_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tickets internos (docs/tickets.md). Aditiva: só tabelas novas.
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "departmentId" TEXT,
    "conversationId" TEXT,
    "createdById" TEXT,
    "dueAt" TIMESTAMP(3),
    "holdReasonId" TEXT,
    "holdNote" TEXT,
    "holdUntil" TIMESTAMP(3),
    "holdSince" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_participants" (
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'participant',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_participants_pkey" PRIMARY KEY ("ticketId","userId")
);

CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "body" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_hold_reasons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_hold_reasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tickets_tenantId_number_key" ON "tickets"("tenantId", "number");
CREATE INDEX "tickets_tenantId_status_idx" ON "tickets"("tenantId", "status");
CREATE INDEX "tickets_departmentId_idx" ON "tickets"("departmentId");
CREATE INDEX "tickets_conversationId_idx" ON "tickets"("conversationId");
CREATE INDEX "ticket_participants_userId_idx" ON "ticket_participants"("userId");
CREATE INDEX "ticket_events_ticketId_createdAt_idx" ON "ticket_events"("ticketId", "createdAt");
CREATE UNIQUE INDEX "ticket_hold_reasons_tenantId_name_key" ON "ticket_hold_reasons"("tenantId", "name");

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_holdReasonId_fkey" FOREIGN KEY ("holdReasonId") REFERENCES "ticket_hold_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_hold_reasons" ADD CONSTRAINT "ticket_hold_reasons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Novas permissões nos perfis padrão que o cliente não editou: Administrador e Gerente ganham as
-- quatro; Atendente abre e atende. Perfil editado é escolha do cliente (docs/18-perfis-de-acesso.md).
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['tickets.create','tickets.handle','tickets.view_all','tickets.manage']::TEXT[]))
WHERE "isSystem" = true AND "customized" = false AND "systemRole" IN ('tenant_admin', 'manager');
UPDATE "access_profiles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['tickets.create','tickets.handle']::TEXT[]))
WHERE "isSystem" = true AND "customized" = false AND "systemRole" = 'agent';

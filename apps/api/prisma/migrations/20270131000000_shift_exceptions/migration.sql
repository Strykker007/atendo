-- Exceções de um dia na escala (docs/escalas.md#calendário): folga e turno extra. Aditiva.
CREATE TYPE "ShiftExceptionKind" AS ENUM ('off', 'extra');

CREATE TABLE "shift_exceptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" "ShiftExceptionKind" NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shift_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_exceptions_userId_date_kind_key" ON "shift_exceptions"("userId", "date", "kind");
CREATE INDEX "shift_exceptions_tenantId_date_idx" ON "shift_exceptions"("tenantId", "date");

ALTER TABLE "shift_exceptions" ADD CONSTRAINT "shift_exceptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_exceptions" ADD CONSTRAINT "shift_exceptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Escalas de trabalho, trava de login por turno e acessos temporários (docs/escalas.md)
CREATE TYPE "WorkScheduleType" AS ENUM ('FIXED_12X36', 'COMMERCIAL_44H', 'CUSTOM');

CREATE TABLE "work_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WorkScheduleType" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "workDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "restHours" INTEGER NOT NULL DEFAULT 0,
    "anchorDate" TEXT,
    "toleranceMinutes" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "work_schedules_tenantId_idx" ON "work_schedules"("tenantId");
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "scheduleId" TEXT,
ADD COLUMN "isTemporary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "accessExpiresAt" TIMESTAMP(3),
ADD COLUMN "expiredAt" TIMESTAMP(3),
ADD COLUMN "temporaryCreatedById" TEXT;
CREATE INDEX "users_scheduleId_idx" ON "users"("scheduleId");
CREATE INDEX "users_accessExpiresAt_idx" ON "users"("accessExpiresAt");
ALTER TABLE "users" ADD CONSTRAINT "users_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "work_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_temporaryCreatedById_fkey" FOREIGN KEY ("temporaryCreatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "schedule_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "approvedById" TEXT,
    "reason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schedule_overrides_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "schedule_overrides_tenantId_validUntil_idx" ON "schedule_overrides"("tenantId", "validUntil");
CREATE INDEX "schedule_overrides_userId_validUntil_idx" ON "schedule_overrides"("userId", "validUntil");
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

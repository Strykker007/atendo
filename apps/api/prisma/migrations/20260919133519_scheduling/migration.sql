-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('scheduled', 'confirmed', 'done', 'no_show', 'canceled');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('flow', 'panel', 'agenda');

-- CreateTable
CREATE TABLE "scheduling_settings" (
    "tenantId" TEXT NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 30,
    "clientReminderMinutes" JSONB NOT NULL DEFAULT '[1440, 60]',
    "proReminderMinutes" INTEGER NOT NULL DEFAULT 15,
    "numberId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "daysAhead" INTEGER NOT NULL DEFAULT 7,

    CONSTRAINT "scheduling_settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "professionals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "userId" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2f5bea',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'scheduled',
    "source" "AppointmentSource" NOT NULL DEFAULT 'panel',
    "notes" TEXT,
    "clientRemindersSent" JSONB NOT NULL DEFAULT '[]',
    "proReminderSentAt" TIMESTAMP(3),
    "rescheduleRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "professionals_tenantId_idx" ON "professionals"("tenantId");

-- CreateIndex
CREATE INDEX "working_hours_professionalId_weekday_idx" ON "working_hours"("professionalId", "weekday");

-- CreateIndex
CREATE INDEX "services_tenantId_idx" ON "services"("tenantId");

-- CreateIndex
CREATE INDEX "appointments_tenantId_startAt_idx" ON "appointments"("tenantId", "startAt");

-- CreateIndex
CREATE INDEX "appointments_professionalId_startAt_idx" ON "appointments"("professionalId", "startAt");

-- CreateIndex
CREATE INDEX "appointments_contactId_startAt_idx" ON "appointments"("contactId", "startAt");

-- AddForeignKey
ALTER TABLE "scheduling_settings" ADD CONSTRAINT "scheduling_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


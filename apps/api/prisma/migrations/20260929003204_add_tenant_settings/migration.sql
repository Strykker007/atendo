-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenantId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "attendanceActive" BOOLEAN NOT NULL DEFAULT true,
    "outsideHoursText" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "business_hours" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_hours_tenantId_weekday_idx" ON "business_hours"("tenantId", "weekday");

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O fuso passa a ser do tenant. Copia o que já existia no agendamento ANTES de dropar a
-- coluna — na ordem gerada pelo Prisma o valor seria perdido em qualquer base com fuso
-- diferente do padrão.
INSERT INTO "tenant_settings" ("tenantId", "timezone", "updatedAt")
SELECT s."tenantId", s."timezone", now() FROM "scheduling_settings" s
ON CONFLICT ("tenantId") DO UPDATE SET "timezone" = EXCLUDED."timezone";

-- AlterTable
ALTER TABLE "scheduling_settings" DROP COLUMN "timezone";

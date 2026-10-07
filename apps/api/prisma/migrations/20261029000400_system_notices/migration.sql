-- Avisos globais do dono do sistema (docs/avisos.md)
CREATE TYPE "SystemNoticeType" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "system_notices" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "SystemNoticeType" NOT NULL DEFAULT 'INFO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_notices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_notices_active_createdAt_idx" ON "system_notices"("active", "createdAt");

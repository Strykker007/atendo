-- Pedido de autorização de plantão feito na tela de login (docs/escalas.md#pedido-de-autorização)
CREATE TYPE "AccessRequestStatus" AS ENUM ('pending', 'approved', 'denied');

CREATE TABLE "schedule_access_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approverId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "overrideId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "schedule_access_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "schedule_access_requests_tenantId_status_idx" ON "schedule_access_requests"("tenantId", "status");
CREATE INDEX "schedule_access_requests_userId_status_idx" ON "schedule_access_requests"("userId", "status");
ALTER TABLE "schedule_access_requests" ADD CONSTRAINT "schedule_access_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_access_requests" ADD CONSTRAINT "schedule_access_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_access_requests" ADD CONSTRAINT "schedule_access_requests_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

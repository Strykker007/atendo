-- Metas mensais por consultor (docs/metas.md)
CREATE TABLE "sales_goals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revenueTarget" DECIMAL(12,2),
    "wonTarget" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_goals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_goals_tenantId_month_userId_key" ON "sales_goals"("tenantId", "month", "userId");
ALTER TABLE "sales_goals" ADD CONSTRAINT "sales_goals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


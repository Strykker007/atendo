-- Personalização do plano por cliente: valor, limites e vigência (docs/05-planos-e-cobranca.md#personalização-por-cliente).
CREATE TABLE "plan_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "priceMonth" DECIMAL(10,2),
    "limits" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_overrides_tenantId_key" ON "plan_overrides"("tenantId");
CREATE INDEX "plan_overrides_expiresAt_idx" ON "plan_overrides"("expiresAt");

ALTER TABLE "plan_overrides" ADD CONSTRAINT "plan_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_overrides" ADD CONSTRAINT "plan_overrides_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

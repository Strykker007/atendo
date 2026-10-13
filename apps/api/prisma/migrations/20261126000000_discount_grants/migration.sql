-- Livro de descontos: registro permanente de cada concessão de valor (docs/05-planos-e-cobranca.md#livro-de-descontos).
CREATE TYPE "DiscountKind" AS ENUM ('promotion', 'negotiated');
CREATE TYPE "DiscountSource" AS ENUM ('checkout', 'tenant_create', 'manual', 'bulk', 'plan_return');

CREATE TABLE "discount_grants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "planId" TEXT,
    "promotionId" TEXT,
    "kind" "DiscountKind" NOT NULL,
    "source" "DiscountSource" NOT NULL,
    "tenantName" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "promotionName" TEXT,
    "listPrice" DECIMAL(10,2) NOT NULL,
    "priceMonth" DECIMAL(10,2) NOT NULL,
    "discountPercent" DECIMAL(6,2) NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "grantedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discount_grants_tenantId_idx" ON "discount_grants"("tenantId");
CREATE INDEX "discount_grants_startsAt_idx" ON "discount_grants"("startsAt");

ALTER TABLE "discount_grants" ADD CONSTRAINT "discount_grants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_grants" ADD CONSTRAINT "discount_grants_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_grants" ADD CONSTRAINT "discount_grants_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

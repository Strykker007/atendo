-- Planos gratuitos (cortesia/degustação/freemium) e modalidade de cobrança
CREATE TYPE "BillingCycle" AS ENUM ('free', 'monthly', 'yearly', 'custom');

ALTER TABLE "plans"
  ADD COLUMN "priceYear" DECIMAL(10,2),
  ADD COLUMN "isFree" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billingCycle" "BillingCycle" NOT NULL DEFAULT 'monthly',
  ADD COLUMN "durationDays" INTEGER;

-- CreateEnum
CREATE TYPE "BillingGateway" AS ENUM ('stripe', 'asaas');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "asaasCustomerId" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "gateway" "BillingGateway";

-- CreateIndex
CREATE UNIQUE INDEX "tenants_asaasCustomerId_key" ON "tenants"("asaasCustomerId");

-- Assinaturas já vinculadas a um gateway até aqui são todas do Stripe
UPDATE "subscriptions" SET "gateway" = 'stripe' WHERE "externalId" IS NOT NULL;

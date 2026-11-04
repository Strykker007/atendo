-- VogoPartners (docs/37-vogopartners.md). Aditiva: valor novo no enum, colunas opcionais e tabelas novas.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'partner';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "partnerId" TEXT,
ADD COLUMN "totpConfirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "partnerId" TEXT,
ADD COLUMN "partnerAttributedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "finance_entries" ADD COLUMN "partnerPayoutId" TEXT;

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "pixKey" TEXT,
    "pixKeyType" TEXT,
    "pixKeyChangedAt" TIMESTAMP(3),
    "setupRate" DECIMAL(5,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_tiers" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT,
    "minClients" INTEGER NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "setupRate" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "setupFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minPayout" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pixKeyCooldownHours" INTEGER NOT NULL DEFAULT 24,
    "secondApprovalAbove" DECIMAL(12,2),
    "dailyLimit" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_commissions" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "baseAmount" DECIMAL(12,2) NOT NULL,
    "rate" DECIMAL(5,2),
    "amount" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_payouts" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "activeClients" INTEGER,
    "rate" DECIMAL(5,2),
    "baseTotal" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "pixKey" TEXT,
    "pixKeyType" TEXT,
    "transferId" TEXT,
    "transferStatus" TEXT,
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidVia" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_events" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "partnerId" TEXT,
    "payoutId" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_events_pkey" PRIMARY KEY ("id")
);

-- Programa nasce com a faixa padrão de 20% e a configuração padrão (30% da instalação)
INSERT INTO "partner_settings" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP);
INSERT INTO "partner_tiers" ("id", "partnerId", "minClients", "rate") VALUES ('default-tier-0', NULL, 0, 20);

-- Categoria de fábrica para a saída do pagamento a parceiros (fechamento financeiro)
INSERT INTO "finance_categories" ("id", "name", "section", "system") VALUES ('comissao_parceiros', 'Comissões de parceiros', 'cost', true) ON CONFLICT ("id") DO NOTHING;

-- CreateIndex
CREATE INDEX "users_partnerId_idx" ON "users"("partnerId");
CREATE INDEX "tenants_partnerId_idx" ON "tenants"("partnerId");
CREATE UNIQUE INDEX "finance_entries_partnerPayoutId_key" ON "finance_entries"("partnerPayoutId");
CREATE INDEX "partner_tiers_partnerId_idx" ON "partner_tiers"("partnerId");
CREATE INDEX "partner_commissions_partnerId_kind_status_idx" ON "partner_commissions"("partnerId", "kind", "status");
CREATE INDEX "partner_commissions_payoutId_idx" ON "partner_commissions"("payoutId");
CREATE UNIQUE INDEX "partner_commissions_sourceType_sourceId_kind_key" ON "partner_commissions"("sourceType", "sourceId", "kind");
CREATE UNIQUE INDEX "partner_payouts_transferId_key" ON "partner_payouts"("transferId");
CREATE INDEX "partner_payouts_status_idx" ON "partner_payouts"("status");
CREATE UNIQUE INDEX "partner_payouts_partnerId_kind_period_key" ON "partner_payouts"("partnerId", "kind", "period");
CREATE INDEX "partner_events_partnerId_createdAt_idx" ON "partner_events"("partnerId", "createdAt" DESC);
CREATE INDEX "partner_events_createdAt_idx" ON "partner_events"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "partner_tiers" ADD CONSTRAINT "partner_tiers_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "partner_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

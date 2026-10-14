-- Orçamentos com link público (docs/orcamentos.md)
CREATE TYPE "BudgetStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED');

CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totalValue" DECIMAL(12,2) NOT NULL,
    "pixKey" TEXT,
    "pixKeyType" TEXT,
    "pixHolderName" TEXT,
    "paymentUrl" TEXT,
    "note" TEXT,
    "status" "BudgetStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "receiptKey" TEXT,
    "receiptMime" TEXT,
    "receiptName" TEXT,
    "receiptAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "budgets_hash_key" ON "budgets"("hash");
CREATE INDEX "budgets_conversationId_createdAt_idx" ON "budgets"("conversationId", "createdAt");
CREATE INDEX "budgets_tenantId_status_idx" ON "budgets"("tenantId", "status");
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fluxo padrão por desfecho do encerramento (Comprou / Não comprou / Sem resultado)
ALTER TABLE "tenant_settings" ADD COLUMN "wonFlowId" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN "lostFlowId" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN "noneFlowId" TEXT;

-- Venda registrada no encerramento "Comprou"
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "products" TEXT,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_tenantId_closedAt_idx" ON "sales"("tenantId", "closedAt");
CREATE INDEX "sales_tenantId_userId_closedAt_idx" ON "sales"("tenantId", "userId", "closedAt");
CREATE INDEX "sales_conversationId_idx" ON "sales"("conversationId");

ALTER TABLE "sales" ADD CONSTRAINT "sales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

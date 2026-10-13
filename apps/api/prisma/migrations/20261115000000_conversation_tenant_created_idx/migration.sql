-- relatórios filtram conversas por cliente + período (reports.module.ts)
CREATE INDEX "conversations_tenantId_createdAt_idx" ON "conversations"("tenantId", "createdAt");

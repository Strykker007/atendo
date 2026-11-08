-- Fila de atendimento com distribuição automática e pausa do atendente (docs/fila-de-atendimento.md).
-- Só acrescenta: colunas com default (desligada para todos) e uma tabela nova.
ALTER TABLE "tenant_settings" ADD COLUMN "autoDistribute" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN "autoDistributeMax" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "tenant_settings" ADD COLUMN "autoDistributeLockClaim" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "agent_pauses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "until" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,

    CONSTRAINT "agent_pauses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_pauses_tenantId_endedAt_idx" ON "agent_pauses"("tenantId", "endedAt");
CREATE INDEX "agent_pauses_userId_startedAt_idx" ON "agent_pauses"("userId", "startedAt");

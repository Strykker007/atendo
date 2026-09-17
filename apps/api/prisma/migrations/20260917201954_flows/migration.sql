-- CreateEnum
CREATE TYPE "FlowRunStatus" AS ENUM ('running', 'waiting', 'done', 'stopped', 'failed');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "activeFlowRunId" TEXT;

-- CreateTable
CREATE TABLE "flows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "trigger" JSONB NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "FlowRunStatus" NOT NULL DEFAULT 'running',
    "currentNodeId" TEXT,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "waitUntil" TIMESTAMP(3),
    "startedById" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "flow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flows_tenantId_idx" ON "flows"("tenantId");

-- CreateIndex
CREATE INDEX "flow_runs_conversationId_status_idx" ON "flow_runs"("conversationId", "status");

-- CreateIndex
CREATE INDEX "flow_runs_flowId_startedAt_idx" ON "flow_runs"("flowId", "startedAt");

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


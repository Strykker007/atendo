-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "closedFlowId" TEXT,
ADD COLUMN     "defaultFlowId" TEXT,
ADD COLUMN     "defaultFlowInactivityHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "welcomeFlowId" TEXT;


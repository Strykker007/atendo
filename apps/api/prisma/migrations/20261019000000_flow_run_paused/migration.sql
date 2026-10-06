-- Pausar fluxo congela o run (antes ele era interrompido e não voltava).
ALTER TYPE "FlowRunStatus" ADD VALUE 'paused';
ALTER TABLE "flow_runs" ADD COLUMN "pausedFrom" "FlowRunStatus";

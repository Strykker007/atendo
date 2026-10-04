-- Controle de concorrência no salvamento de fluxos (optimistic locking). Ver docs/fluxos.md.
ALTER TABLE "flows" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

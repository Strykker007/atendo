-- Relatório diário por e-mail (docs/relatorio-diario.md): opt-in por usuário. Aditiva.
ALTER TABLE "users" ADD COLUMN "dailyReportEmail" BOOLEAN NOT NULL DEFAULT false;

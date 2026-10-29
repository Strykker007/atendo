-- Separar equipe, planilha de contatos e transmissões por empresa (opt-in por cliente).
-- Aditiva: padrão false mantém o comportamento atual de todos os clientes.
ALTER TABLE "tenant_settings" ADD COLUMN "companyIsolation" BOOLEAN NOT NULL DEFAULT false;

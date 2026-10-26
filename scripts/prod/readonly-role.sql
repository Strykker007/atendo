-- Papel SÓ DE LEITURA para diagnóstico em produção (docs/33-operacao-segura-producao.md).
-- Rodar UMA vez, como o superusuário, dentro do container do Postgres:
--   ssh -i ~/.ssh/atendo-prod.key ubuntu@163.176.200.252 \
--     'docker exec -i atendo-prod-postgres-1 sh -c "psql -v ON_ERROR_STOP=1 -U \$POSTGRES_USER -d \$POSTGRES_DB"' \
--     < scripts/prod/readonly-role.sql
--
-- Sem senha: só entra pelo socket de dentro do container (o pg_hba da imagem confia no socket
-- local e exige senha por rede). Não grava nada, nem que alguém mande `SET ... read_only = off`.
-- Idempotente: rodar de novo não quebra.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atendo_ro') THEN
    CREATE ROLE atendo_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;

ALTER ROLE atendo_ro SET default_transaction_read_only = on;
-- consulta pesada não pode segurar o banco da produção
ALTER ROLE atendo_ro SET statement_timeout = '30s';

GRANT CONNECT ON DATABASE atendo TO atendo_ro;
GRANT USAGE ON SCHEMA public TO atendo_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO atendo_ro;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO atendo_ro;
-- tabelas criadas pelas próximas migrations (o dono delas é o usuário da aplicação)
ALTER DEFAULT PRIVILEGES FOR ROLE atendo IN SCHEMA public GRANT SELECT ON TABLES TO atendo_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE atendo IN SCHEMA public GRANT SELECT ON SEQUENCES TO atendo_ro;

-- conferência: tem que listar atendo_ro sem superusuário
SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = 'atendo_ro';

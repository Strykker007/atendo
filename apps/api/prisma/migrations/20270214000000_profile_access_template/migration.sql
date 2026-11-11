-- Acesso padrão do perfil (docs/18-perfis-de-acesso.md#acesso-padrão-do-perfil). Aditiva: null = sem padrão.
ALTER TABLE "access_profiles" ADD COLUMN "accessTemplate" JSONB;

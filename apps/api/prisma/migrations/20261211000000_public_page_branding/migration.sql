-- Frase da foto protegida e logo da empresa nas páginas públicas (docs/foto-protegida.md)
ALTER TABLE "tenant_settings" ADD COLUMN "secureMediaText" TEXT;
ALTER TABLE "tenant_settings" ADD COLUMN "publicLogoKey" TEXT;

-- Empresa removida fica para os relatórios (docs/empresas.md#remover)
ALTER TABLE "companies" ADD COLUMN "deletedAt" TIMESTAMP(3);

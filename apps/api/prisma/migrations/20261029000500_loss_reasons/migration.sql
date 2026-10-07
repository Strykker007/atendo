-- Motivos de perda configuráveis (Configurações → Motivos de perda)
ALTER TABLE "tenant_settings" ADD COLUMN "lossReasons" TEXT[] DEFAULT ARRAY['Preço', 'Prazo', 'Não respondeu', 'Comprou com concorrente', 'Fora da área', 'Só pesquisando']::TEXT[];

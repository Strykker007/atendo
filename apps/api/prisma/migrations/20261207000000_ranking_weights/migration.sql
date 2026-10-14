-- Pesos da pontuação do ranking de consultores (docs/metas.md › Ranking). Nulo = padrão
ALTER TABLE "tenant_settings" ADD COLUMN "rankingWeights" JSONB;

-- Pesquisa de satisfação com até 2 perguntas adicionais (docs/pesquisa-de-satisfacao.md#perguntas-adicionais)
ALTER TABLE "satisfaction_surveys" ADD COLUMN "extraQuestions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "survey_responses" ADD COLUMN "step" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "survey_responses" ADD COLUMN "questions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "survey_responses" ADD COLUMN "answers" JSONB NOT NULL DEFAULT '[]';

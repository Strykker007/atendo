-- Tags de transição × permanentes (docs/06-modelo-de-dados.md#tags). Aditiva: tipo novo e coluna
-- com padrão; a API anterior ignora a coluna e continua funcionando igual.
DO $$ BEGIN
  CREATE TYPE "TagKind" AS ENUM ('permanent', 'transition');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "kind" "TagKind" NOT NULL DEFAULT 'transition';
CREATE INDEX IF NOT EXISTS "tags_tenantId_kind_idx" ON "tags"("tenantId", "kind");

-- Separar pelo uso: vira permanente só a tag que está em contato e nunca marcou atendimento
-- (nem coluna do Kanban, nem de encerramento, nem em conversa aberta, nem no histórico de
-- encerramentos). O resto continua transição. Nenhum vínculo é apagado. O histórico é lido numa
-- passada só (conversation_events é grande).
WITH no_atendimento AS (
  SELECT DISTINCT x AS id FROM (
    SELECT unnest(e."tagIds" || e."tagSnapshot") AS x FROM "conversation_events" e
    WHERE cardinality(e."tagIds") > 0 OR cardinality(e."tagSnapshot") > 0
    UNION ALL
    SELECT e."stageTagId" FROM "conversation_events" e WHERE e."stageTagId" IS NOT NULL
  ) u
)
UPDATE "tags" t SET "kind" = 'permanent'
WHERE t."isKanban" = false AND t."showOnWon" = false AND t."showOnLost" = false
  AND EXISTS (SELECT 1 FROM "contact_tags" c WHERE c."tagId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "conversation_tags" v WHERE v."tagId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM no_atendimento n WHERE n.id = t."id");

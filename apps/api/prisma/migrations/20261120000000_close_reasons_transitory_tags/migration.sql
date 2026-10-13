-- Motivo de encerramento de volta (separado das tags) + tags transitórias + último encerramento
-- na conversa (docs/06-modelo-de-dados.md#encerramento).

-- 1) lista de motivos
CREATE TABLE "close_reasons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#94a3b8',
    "outcome" TEXT NOT NULL DEFAULT 'both',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "close_reasons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "close_reasons_tenantId_name_key" ON "close_reasons"("tenantId", "name");
ALTER TABLE "close_reasons" ADD CONSTRAINT "close_reasons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) motivos iniciais = as tags que hoje aparecem no encerramento, com a cor e o resultado delas
INSERT INTO "close_reasons" ("id", "tenantId", "name", "color", "outcome", "position", "isActive", "createdAt")
SELECT gen_random_uuid(), t."tenantId", t."name", t."color",
       CASE WHEN t."showOnWon" AND t."showOnLost" THEN 'both' WHEN t."showOnWon" THEN 'won' ELSE 'lost' END,
       t."position", true, NOW()
FROM "tags" t WHERE t."showOnWon" OR t."showOnLost"
ON CONFLICT ("tenantId", "name") DO NOTHING;

-- motivo antigo em texto livre (encerramento de antes das tags): vira motivo INATIVO, só para o
-- histórico e o relatório continuarem com o nome — não aparece para escolher
INSERT INTO "close_reasons" ("id", "tenantId", "name", "color", "outcome", "position", "isActive", "createdAt")
SELECT gen_random_uuid(), x."tenantId", x."name", '#94a3b8', 'lost', 999, false, NOW()
FROM (
  SELECT DISTINCT e."tenantId", LEFT(TRIM(regexp_replace(e."reason", '(\s*·\s*)?encerrado em massa$', '')), 80) AS "name"
  FROM "conversation_events" e
  WHERE e."type" = 'closed' AND COALESCE(cardinality(e."tagIds"), 0) = 0 AND e."reason" IS NOT NULL AND e."reason" <> 'automação'
) x
WHERE x."name" <> ''
ON CONFLICT ("tenantId", "name") DO NOTHING;

-- 3) histórico do encerramento: motivo, etapa e todas as tags
ALTER TABLE "conversation_events" ADD COLUMN "closeReasonId" TEXT;
ALTER TABLE "conversation_events" ADD COLUMN "stageTagId" TEXT;
ALTER TABLE "conversation_events" ADD COLUMN "tagSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- encerramento com tag: o motivo é a primeira tag escolhida que virou motivo
UPDATE "conversation_events" e SET "closeReasonId" = (
  SELECT r."id" FROM unnest(e."tagIds") WITH ORDINALITY AS u(tid, ord)
  JOIN "tags" t ON t."id" = u.tid
  JOIN "close_reasons" r ON r."tenantId" = e."tenantId" AND r."name" = t."name"
  ORDER BY u.ord LIMIT 1)
WHERE e."type" = 'closed' AND COALESCE(cardinality(e."tagIds"), 0) > 0;
-- encerramento antigo em texto: pelo nome
UPDATE "conversation_events" e SET "closeReasonId" = r."id"
FROM "close_reasons" r
WHERE e."type" = 'closed' AND e."closeReasonId" IS NULL AND e."reason" IS NOT NULL
  AND r."tenantId" = e."tenantId" AND r."name" = LEFT(TRIM(regexp_replace(e."reason", '(\s*·\s*)?encerrado em massa$', '')), 80);
UPDATE "conversation_events" SET "tagSnapshot" = "tagIds" WHERE "type" = 'closed';

-- 4) tags transitórias: conversa encerrada não guarda tag (nem etapa do Kanban). Antes de tirar,
-- congela no último encerramento dela, para o relatório não perder
UPDATE "conversation_events" e SET
  "tagSnapshot" = ARRAY(SELECT DISTINCT x FROM unnest(e."tagSnapshot" || ARRAY(SELECT ct."tagId" FROM "conversation_tags" ct WHERE ct."conversationId" = e."conversationId")) AS x),
  "stageTagId" = (SELECT ct."tagId" FROM "conversation_tags" ct WHERE ct."conversationId" = e."conversationId" AND ct."isPrimary" LIMIT 1)
WHERE e."id" IN (SELECT DISTINCT ON ("conversationId") "id" FROM "conversation_events" WHERE "type" = 'closed' ORDER BY "conversationId", "createdAt" DESC)
  AND e."conversationId" IN (SELECT "id" FROM "conversations" WHERE "status" = 'closed');
DELETE FROM "conversation_tags" ct USING "conversations" c WHERE c."id" = ct."conversationId" AND c."status" = 'closed';

-- 5) último encerramento na conversa (sobrevive à reabertura)
ALTER TABLE "conversations" ADD COLUMN "lastClosedAt" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "lastCloseOutcome" "ConversationOutcome";
ALTER TABLE "conversations" ADD COLUMN "lastCloseReasonId" TEXT;
CREATE INDEX "conversations_tenantId_lastCloseReasonId_idx" ON "conversations"("tenantId", "lastCloseReasonId");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lastCloseReasonId_fkey" FOREIGN KEY ("lastCloseReasonId") REFERENCES "close_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "conversations" c SET "lastClosedAt" = x."createdAt", "lastCloseOutcome" = x."outcome", "lastCloseReasonId" = x."closeReasonId"
FROM (SELECT DISTINCT ON ("conversationId") "conversationId", "createdAt", "outcome", "closeReasonId" FROM "conversation_events" WHERE "type" = 'closed' ORDER BY "conversationId", "createdAt" DESC) x
WHERE x."conversationId" = c."id";

-- 6) as tags que viraram motivo deixam de aparecer no encerramento (senão o modal mostraria o
-- mesmo nome duas vezes, como motivo e como tag). A tag continua existindo e no histórico.
UPDATE "tags" SET "showOnWon" = false, "showOnLost" = false WHERE "showOnWon" OR "showOnLost";

-- Motivos de perda deixam de ser lista à parte: viram tags (docs/06-modelo-de-dados.md).

-- 1) cada motivo cadastrado vira uma tag do cliente, com a cor que tinha, fora do Kanban.
--    Nome de tag tem 40 caracteres; tag que já existe com o mesmo nome é reaproveitada.
INSERT INTO "tags" ("id", "tenantId", "name", "color", "isKanban", "position", "createdAt")
SELECT gen_random_uuid(), s."tenantId", r.name, COALESCE(s."lossReasonColors"->>r.original, '#94a3b8'), false, 0, NOW()
FROM "tenant_settings" s
CROSS JOIN LATERAL (
  SELECT DISTINCT ON (LEFT(TRIM(m), 40)) m AS original, LEFT(TRIM(m), 40) AS name
  FROM unnest(s."lossReasons") AS m
  WHERE TRIM(m) <> ''
) r
ON CONFLICT ("tenantId", "name") DO NOTHING;

-- 2) tags do encerramento ficam no evento
ALTER TABLE "conversation_events" ADD COLUMN "tagIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 3) histórico: "Não comprou" com motivo igual ao nome de uma tag passa a apontar para ela
--    (o encerramento em massa gravava "<motivo> · encerrado em massa")
UPDATE "conversation_events" e
SET "tagIds" = ARRAY[t."id"]
FROM "tags" t
WHERE e."type" = 'closed' AND e."outcome" = 'lost' AND e."reason" IS NOT NULL
  AND t."tenantId" = e."tenantId"
  AND t."name" = LEFT(TRIM(regexp_replace(e."reason", '(\s*·\s*)?encerrado em massa$', '')), 40);

-- 4) fim da lista de motivos e do "Sem resultado" como escolha no encerramento
ALTER TABLE "tenant_settings" DROP COLUMN "lossReasons", DROP COLUMN "lossReasonColors", DROP COLUMN "noneFlowId";

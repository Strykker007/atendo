-- Kanban: tags viram colunas e cada atendimento tem no máximo uma tag principal
ALTER TABLE "tags" ADD COLUMN "isKanban" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "conversation_tags" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- ordem inicial das colunas = ordem alfabética (era como a tela de tags listava)
UPDATE "tags" t SET "position" = o.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "name") - 1 AS rn FROM "tags") o
WHERE t."id" = o."id";


-- quem já tinha tag entra no quadro: a primeira na ordem das colunas vira a principal
UPDATE "conversation_tags" ct SET "isPrimary" = true
FROM (
  SELECT DISTINCT ON (x."conversationId") x."conversationId", x."tagId"
    FROM "conversation_tags" x JOIN "tags" t ON t."id" = x."tagId"
   ORDER BY x."conversationId", t."position", t."name"
) p
WHERE ct."conversationId" = p."conversationId" AND ct."tagId" = p."tagId";

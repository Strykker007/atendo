-- Ordem manual da lista de fluxos (arrastar, como nas respostas rápidas). Começa pela ordem alfabética de hoje
ALTER TABLE "flows" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
UPDATE "flows" f SET "position" = o.rn - 1
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY name) AS rn FROM "flows") o
WHERE f.id = o.id;

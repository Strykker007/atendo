-- "Aparece no encerramento" separado por resultado: Comprou e Não comprou (docs/06-modelo-de-dados.md).
ALTER TABLE "tags" ADD COLUMN "showOnWon" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tags" ADD COLUMN "showOnLost" BOOLEAN NOT NULL DEFAULT false;

-- Nada muda para quem já usa: o que aparecia no encerramento continua aparecendo nos DOIS
-- (antes a mesma lista valia para Comprou e Não comprou). O cliente tira de um deles se quiser.
UPDATE "tags" SET "showOnWon" = true, "showOnLost" = true WHERE "showOnClose" = true;

ALTER TABLE "tags" DROP COLUMN "showOnClose";

-- Nome do autor gravado na nota interna: continua assinada depois que o usuário é removido.
ALTER TABLE "messages" ADD COLUMN "authorName" TEXT;

-- notas antigas: copia o nome de quem ainda existe
UPDATE "messages" m SET "authorName" = u."name"
FROM "users" u
WHERE m."internal" = true AND m."authorId" = u."id";

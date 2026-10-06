-- Busca de contatos sem acento, sem diferença de maiúsculas e por pedaços (docs/07-api.md).
-- `searchText` é coluna GERADA: o banco mantém sozinha a partir de nome/e-mail/telefone, e o
-- índice trigram (pg_trgm) atende o `LIKE '%termo%'` que o Prisma gera para `contains`.
-- `translate` (e não a extensão unaccent) porque coluna gerada só aceita função IMMUTABLE;
-- maiúsculas acentuadas vão na lista porque `lower` em collation C não as converte.
-- Tem de bater com `foldSearch` em src/common/text-search.ts.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "contacts" ADD COLUMN "searchText" TEXT GENERATED ALWAYS AS (
  lower(translate(
    coalesce("name", '') || ' ' || coalesce("email", '') || ' ' || "phone",
    'áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ',
    'aaaaaaeeeeiiiiooooouuuucnyyaaaaaaeeeeiiiiooooouuuucny'
  ))
) STORED;

ALTER TABLE "phonebook_entries" ADD COLUMN "searchText" TEXT GENERATED ALWAYS AS (
  lower(translate(
    "name" || ' ' || "phone",
    'áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ',
    'aaaaaaeeeeiiiiooooouuuucnyyaaaaaaeeeeiiiiooooouuuucny'
  ))
) STORED;

CREATE INDEX "contacts_searchText_idx" ON "contacts" USING GIN ("searchText" gin_trgm_ops);
CREATE INDEX "phonebook_entries_searchText_idx" ON "phonebook_entries" USING GIN ("searchText" gin_trgm_ops);

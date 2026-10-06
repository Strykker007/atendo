-- De onde veio o nome do contato. Antes, toda mensagem recebida trocava o nome pelo pushName,
-- desfazendo a correção feita na ficha.
CREATE TYPE "ContactNameSource" AS ENUM ('whatsapp', 'agenda', 'manual');
ALTER TABLE "contacts" ADD COLUMN "nameSource" "ContactNameSource" NOT NULL DEFAULT 'whatsapp';

-- Nome que não bate com o pushName da última mensagem recebida (ou sem mensagem recebida com
-- pushName) não veio do WhatsApp: foi digitado na ficha, num fluxo ou no cadastro — protege.
UPDATE "contacts" c SET "nameSource" = 'manual'
WHERE c."name" IS NOT NULL
  AND c."name" IS DISTINCT FROM (
    SELECT m."raw"->>'pushName' FROM "messages" m JOIN "conversations" cv ON cv."id" = m."conversationId"
    WHERE cv."contactId" = c."id" AND m."direction" = 'in' AND m."raw"->>'pushName' IS NOT NULL
    ORDER BY m."createdAt" DESC LIMIT 1
  );

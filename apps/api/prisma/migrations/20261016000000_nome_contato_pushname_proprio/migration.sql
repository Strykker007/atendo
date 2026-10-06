-- Contato criado por mensagem enviada do celular do cliente ganhava o pushName do REMETENTE
-- (o próprio dono do número, ex.: "Tiago"). Limpa só quem tem exatamente esse nome e nunca
-- mandou mensagem com ele; o nome certo volta na próxima mensagem do contato.
UPDATE "contacts" c SET "name" = NULL
WHERE c."name" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "messages" m JOIN "conversations" cv ON cv."id" = m."conversationId"
    WHERE cv."contactId" = c."id" AND m."raw"->'key'->>'fromMe' = 'true' AND m."raw"->>'pushName' = c."name"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "messages" m JOIN "conversations" cv ON cv."id" = m."conversationId"
    WHERE cv."contactId" = c."id" AND m."direction" = 'in' AND m."raw"->>'pushName' = c."name"
  );

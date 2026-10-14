-- Encerramento automático (fluxo "Mudar status → Encerrado", fim de fluxo que encerra) passa a
-- guardar em "targetId" quem da equipe atendeu: o filtro de consultor do relatório traz esses
-- atendimentos (docs/07-api.md › /reports/attendances). Preenche o histórico com a mesma regra do código:
-- o último da equipe que respondeu (sem nota interna) desde o encerramento anterior. Só robô = nulo.
-- Só completa uma coluna vazia; ator, desfecho e datas do evento não mudam.
UPDATE "conversation_events" e SET "targetId" = x.uid
FROM (
  SELECT e2.id, (
    SELECT m."authorId" FROM "messages" m JOIN "users" u ON u.id = m."authorId" AND u."tenantId" = e2."tenantId"
    WHERE m."conversationId" = e2."conversationId" AND m.direction = 'out' AND NOT m.internal AND m."createdAt" < e2."createdAt"
      AND m."createdAt" > COALESCE((SELECT max(p."createdAt") FROM "conversation_events" p WHERE p."conversationId" = e2."conversationId" AND p.type = 'closed' AND p."createdAt" < e2."createdAt"), '-infinity')
    ORDER BY m."createdAt" DESC LIMIT 1
  ) AS uid
  FROM "conversation_events" e2
  WHERE e2.type = 'closed' AND e2."actorId" IS NULL AND e2."targetId" IS NULL
) x
WHERE x.id = e.id AND x.uid IS NOT NULL;

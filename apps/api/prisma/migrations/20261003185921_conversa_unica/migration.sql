-- Uma conversa por contato em cada número.
--
-- Antes, encerrar um atendimento e receber mensagem de novo criava OUTRA conversa: o mesmo
-- contato aparecia duas vezes na tela e o histórico ficava partido entre elas. Esta migration
-- junta o que já está partido e impede que volte a acontecer.
--
-- A conversa que fica é a MAIS ANTIGA do par (número, contato) — ela guarda a data em que a
-- relação com a pessoa começou. Os campos de "agora" (status, dono, última mensagem) vêm da
-- mais recente, que é o estado real de hoje.

-- 1) Antes de fundir: todo encerramento com desfecho que ainda não tem evento vira um evento.
--    O relatório de vendas passa a ler o histórico de atendimentos, e sem isto as vendas
--    registradas antes do histórico existir desapareceriam do relatório.
INSERT INTO "conversation_events" (id, "tenantId", "conversationId", type, "actorId", "toStatus", outcome, "outcomeValue", reason, "createdAt")
SELECT gen_random_uuid(), c."tenantId", c.id, 'closed', c."outcomeById", 'closed', c.outcome, c."outcomeValue", c."outcomeReason",
       coalesce(c."outcomeAt", c."closedAt", c."updatedAt")
  FROM "conversations" c
 WHERE c.outcome <> 'none'
   AND NOT EXISTS (SELECT 1 FROM "conversation_events" e WHERE e."conversationId" = c.id AND e.type = 'closed');

-- 2) Quem fica e quem é absorvido
CREATE TEMP TABLE fusao AS
SELECT c.id AS perdida,
       (SELECT k.id FROM "conversations" k
         WHERE k."numberId" = c."numberId" AND k."contactId" = c."contactId"
         ORDER BY k."createdAt" ASC, k.id ASC LIMIT 1) AS mantida
  FROM "conversations" c;
DELETE FROM fusao WHERE perdida = mantida;

-- 3) Filhos passam para a conversa que fica
UPDATE "messages" m SET "conversationId" = f.mantida FROM fusao f WHERE m."conversationId" = f.perdida;
UPDATE "flow_runs" r SET "conversationId" = f.mantida FROM fusao f WHERE r."conversationId" = f.perdida;
UPDATE "ai_usage" a SET "conversationId" = f.mantida FROM fusao f WHERE a."conversationId" = f.perdida;
UPDATE "conversation_events" e SET "conversationId" = f.mantida FROM fusao f WHERE e."conversationId" = f.perdida;

-- tag é chave composta (conversa, tag): move só o que não existe do outro lado, apaga o resto
UPDATE "conversation_tags" ct SET "conversationId" = f.mantida
  FROM fusao f
 WHERE ct."conversationId" = f.perdida
   AND NOT EXISTS (SELECT 1 FROM "conversation_tags" x WHERE x."conversationId" = f.mantida AND x."tagId" = ct."tagId");
DELETE FROM "conversation_tags" ct USING fusao f WHERE ct."conversationId" = f.perdida;

-- 4) O estado de hoje vem da conversa mais recente do grupo
UPDATE "conversations" k SET
    status = r.status,
    "assigneeId" = r."assigneeId",
    "lastMessageAt" = r."lastMessageAt",
    "lastMessagePreview" = r."lastMessagePreview",
    "lastInboundAt" = greatest(k."lastInboundAt", r."lastInboundAt"),
    "awaitingSince" = r."awaitingSince",
    "unreadCount" = k."unreadCount" + r."unreadCount",
    "closedAt" = r."closedAt",
    "activeFlowRunId" = coalesce(r."activeFlowRunId", k."activeFlowRunId"),
    outcome = r.outcome,
    "outcomeValue" = r."outcomeValue",
    "outcomeReason" = r."outcomeReason",
    "outcomeAt" = r."outcomeAt",
    "outcomeById" = r."outcomeById",
    -- origem de anúncio não se perde: se qualquer uma das conversas veio de anúncio, fica
    origin = CASE WHEN k.origin = 'organic' AND r.origin <> 'organic' THEN r.origin ELSE k.origin END,
    "originData" = CASE WHEN k.origin = 'organic' AND r.origin <> 'organic' THEN r."originData" ELSE k."originData" END
  FROM (
    SELECT DISTINCT ON (c."numberId", c."contactId") c.*
      FROM "conversations" c
     ORDER BY c."numberId", c."contactId", c."lastMessageAt" DESC NULLS LAST, c."createdAt" DESC
  ) r
 WHERE k."numberId" = r."numberId" AND k."contactId" = r."contactId" AND k.id <> r.id
   AND EXISTS (SELECT 1 FROM fusao f WHERE f.mantida = k.id);

-- 5) As absorvidas somem
DELETE FROM "conversations" c USING fusao f WHERE c.id = f.perdida;
DROP TABLE fusao;

-- 6) Trava: daqui em diante é impossível nascer uma segunda conversa para o mesmo contato
CREATE UNIQUE INDEX "conversations_numberId_contactId_key" ON "conversations"("numberId", "contactId");

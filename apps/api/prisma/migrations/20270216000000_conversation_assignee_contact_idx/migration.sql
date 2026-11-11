-- Buscas por atendente e por contato liam a tabela de conversas inteira (docs/escalabilidade.md).
-- Só índices novos: aditivo, a API anterior continua igual.
CREATE INDEX IF NOT EXISTS "conversations_assigneeId_status_idx" ON "conversations"("assigneeId", "status");
CREATE INDEX IF NOT EXISTS "conversations_contactId_idx" ON "conversations"("contactId");

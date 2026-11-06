# Registro de alterações manuais no banco de produção

Cada alteração feita fora do sistema fica aqui ([33](33-operacao-segura-producao.md)). O
`scripts/prod/write.sh --apply` acrescenta a entrada sozinho; commitar junto com a correção que
evita repetir.

## 2026-10-26 15:00 — 18 mensagens de atendentes presas (antes do write.sh)

- quem: Tiago Lima (comando preparado pelo Claude) · linhas: 18 · SQL colado no terminal
- causa: Redis do BullMQ bateu os 512 MB (cache da Evolution no mesmo Redis) e recusou gravar os
  jobs; as mensagens ficaram `pending` sem job desde 8h20–8h25 (e 14h05, Drogarber)
- correção que evita repetir: varredura `outbound-sweep` ([envio.md](envio.md#mensagem-sem-job)) e
  `maxmemory 2gb`; definitivo: Redis próprio da Evolution ([24](24-auditoria-evolution.md))

```sql
update messages
set status = 'failed', error = 'Não enviada: fila indisponível no momento do envio. Reenvie a mensagem.'
where status = 'pending' and id in ( /* 18 ids */ );
```

## 2026-11-06 10:10 — parceiros Thays duplicados

- quem: Tiago Lima · linhas: 16 · arquivo: `/private/tmp/claude-501/-Users-tiagolima-Projetos-atendo/47117862-7f6c-4ca6-9392-f6cfcd278440/scratchpad/limpar-parceiros-thays.sql`

```sql
-- 16 parceiros "Thays" duplicados (06/11): cada tentativa de cadastro criou um parceiro antes de recusar o login.
-- Fica o mais antigo (b0b21de7-…). Só apaga quem não tem login, cliente, comissão nem pagamento.
DELETE FROM partners p
WHERE lower(p.email) = 'tatasousafarias@gmail.com'
  AND p.id <> 'b0b21de7-34a1-4deb-b639-8c169e366941'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u."partnerId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t."partnerId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM partner_commissions c WHERE c."partnerId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM partner_payouts y WHERE y."partnerId" = p.id);
```

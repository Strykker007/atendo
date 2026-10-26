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

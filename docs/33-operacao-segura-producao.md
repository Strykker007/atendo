# 33 — Operação segura em produção

Regra: **ninguém cola SQL de escrita no banco de produção** — nem o time, nem o Claude. Correção de
dado em produção é sintoma de algo que o sistema deveria fazer sozinho. Origem: em 26/10/2026, 18
mensagens presas foram corrigidas com `UPDATE` colado no terminal; a primeira tentativa voltou
`UPDATE 0` porque as aspas se perderam entre Mac → ssh → docker → psql. Errou "para menos"; com outra
combinação de aspas, um `WHERE` perdido vira update na tabela inteira, sem transação, sem conferência
e sem registro.

## Ordem de preferência

1. **O sistema resolve sozinho.** Ex.: mensagem pendente sem job na fila agora é tratada pela
   varredura a cada minuto ([envio.md](envio.md#mensagem-sem-job)). Se um problema pediu SQL à mão,
   a tarefa seguinte é a correção que faz o sistema resolver.
2. **Uma tela ou rota da aplicação** (com permissão, validação e auditoria).
3. **`scripts/prod/write.sh`**, quando 1 e 2 não existem ainda (abaixo).

## Ler: `scripts/prod/read.sh`

Diagnóstico com o papel **`atendo_ro`**: só leitura (`default_transaction_read_only` no papel, só
`SELECT` concedido), `statement_timeout` de 30 s, sem senha e só pelo socket de dentro do container.
Mesmo que alguém mande `SET … read_only = off`, não há permissão de escrita.

```bash
bash scripts/prod/read.sh "select status, count(*) from messages where \"createdAt\" > now() - interval '1 hour' group by 1"
bash scripts/prod/read.sh < consulta.sql   # consulta grande: arquivo, sem aspas no caminho
```

**Criar o papel (uma vez):**

```bash
ssh -i ~/.ssh/atendo-prod.key ubuntu@163.176.200.252 \
  'docker exec -i atendo-prod-postgres-1 sh -c "psql -v ON_ERROR_STOP=1 -U \$POSTGRES_USER -d \$POSTGRES_DB"' \
  < scripts/prod/readonly-role.sql
```

Idempotente. As tabelas de migrations futuras já nascem legíveis por ele (`ALTER DEFAULT PRIVILEGES`).

## Escrever: `scripts/prod/write.sh`

O SQL vai num **arquivo** (um comando `UPDATE`/`DELETE`/`INSERT`), nunca na linha de comando:

```bash
# 1) simulação — roda dentro de uma transação, mostra quantas linhas e DESFAZ
bash scripts/prod/write.sh correcao.sql
# 2) aplicar — só confirma se mudar EXATAMENTE o número esperado
bash scripts/prod/write.sh correcao.sql --apply --expect 18 --motivo "mensagens presas de 26/10"
```

Travas:

| Trava | Por quê |
|---|---|
| Recusa `UPDATE`/`DELETE` sem `WHERE` | o erro mais caro que existe |
| Um comando por arquivo | sem `;` escondendo um segundo comando |
| Simulação é o padrão | ver a contagem antes de gravar |
| `--apply` exige `--expect` e `--motivo` | confirma só se a contagem bater; senão desfaz (testado: contagem errada → nada gravado) |
| SQL pelo stdin | nenhuma aspa atravessa ssh/docker |
| Registro em [operacoes-producao.md](operacoes-producao.md) | data, motivo, quem, linhas e o SQL — commitar junto |

Prefira IDs explícitos (`where id in (…)`) a filtros abertos. `WRITE_LOCAL=1` roda no Postgres do
docker local (teste do próprio script).

## Acesso do Claude

Leitura em produção só pelo `read.sh` (papel `atendo_ro`). Escrita, nunca: prepara o arquivo `.sql`
e o comando, e quem roda é o usuário. A permissão do Claude Code já bloqueia escrita remota.

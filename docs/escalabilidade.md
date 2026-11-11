# Escalabilidade — revisão de 11/11/2026

Revisão feita só com leitura: busca de padrões de risco no código da API e consultas de leitura no
banco e nos containers de produção. Nenhum teste de carga ainda.

## Retrato de produção (11/11/2026)

| Item | Valor |
|---|---|
| Clientes / usuários / números | 70 / 483 / 90 |
| Mensagens (total / últimos 30 dias) | 2,48 mi / 1,75 mi |
| Conversas / contatos | 60,7 mil / 68,6 mil |
| Banco do Atendo | 7,4 GB |
| RAM disponível (de 23 GB) | ~15 GB |
| Maiores consumidores | evolution-db 2,4 GB · evolution 1,5 GB · postgres 0,9 GB · redis 0,9 GB · api 2× ~0,3 GB · worker 2× ~0,16 GB |

## O que já está pronto para crescer

- API e worker com **2 réplicas** cada (`infra/docker-compose.prod.yml`).
- Socket.io com **adapter Redis** (`common/socket-io.adapter.ts`): o evento chega ao atendente em qualquer réplica.
- Tarefas periódicas por `upsertJobScheduler` do BullMQ: **não rodam em dobro** com várias réplicas.
- Listas pesadas paginadas: conversas (`take` 50 + cursor) e mensagens (`MESSAGES_PAGE` + cursor).
- Filas com concorrência definida (envio 20, recebimento 10, campanha 5).
- As demais consultas sem `take` são por lista de ids (`id in [...]`) ou por cliente em tabelas pequenas.

## Riscos encontrados

### 1. Conversas lidas inteiras por atendente e por contato — corrigido
As buscas `where assigneeId = …` (capacidade da fila, "minhas conversas", fim de turno) e
`where contactId = …` sem número não tinham índice: o Postgres lia a tabela inteira. Desde o
último reset das estatísticas, foram 355 mil varreduras completas e **7,2 bilhões de linhas lidas**.
O custo cresce junto com a tabela. Isso seria o primeiro gargalo do banco.

Correção: migration `20270216000000_conversation_assignee_contact_idx` com os índices
`(assigneeId, status)` e `(contactId)`. É aditiva e o `CREATE INDEX` leva menos de 1 s com 60 mil linhas.

### 2. `flow_runs` também lida inteira — origem a confirmar
São 62 mil varreduras completas (1,5 bilhão de linhas). A tabela é pequena (36 mil linhas), mas
cresce a cada fluxo. Sem `pg_stat_statements` não dá para saber qual consulta causa. **Próximo passo:**
[ligar o `pg_stat_statements`](#ligar-pg_stat_statements) e então ver as consultas mais caras.

### 3. Containers sem limite de memória — aplicado na aplicação
Só worker, backup e evolution-db tinham limite (e só de CPU). Um vazamento em um container consumia a
RAM da VM inteira e derrubava todos. Agora há `mem_limit` em `infra/docker-compose.prod.yml`, aplicado
pelo deploy comum (`scripts/deploy.sh`), que já recria esses serviços:

| Serviço | Uso normal | Teto |
|---|---|---|
| api (cada réplica) | ~0,3 GB | 1,5 GB |
| worker (cada réplica) | ~0,16 GB | 2 GB (importação de histórico e mídia) |
| web | ~0,1 GB | 768 MB |
| site | ~40 MB | 384 MB |

Ao bater no teto, o kernel mata só aquele container e o `restart: unless-stopped` o sobe de novo.
O Redis já tem `--maxmemory 2gb`. Evolution e Postgres ficaram sem teto: são serviços protegidos, e
recriar a Evolution reconecta todos os números (docs/27-deploy-evolution.md).

### 4. Evolution é o custo que cresce por número
evolution + evolution-db somam ~3,9 GB para 90 números (~43 MB por número). **Estimativa:** com
1000 empresas (~1.300 números) seriam ~55 GB, o que não cabe numa VM só. O código já tem o
conceito de shard da Evolution (`EvolutionProvider.shard`): o caminho é distribuir os números em
mais de uma VM/instância de Evolution, ou migrar clientes para a API oficial da Meta (sem custo de memória por número).

### 5. Crescimento de `messages`
São 1,75 mi de mensagens em 30 dias com 70 clientes. Com 1000 clientes, a projeção linear é de
~25 mi por mês. A busca por conversa já usa índice (`conversationId, createdAt`), mas o disco
(73 GB livres) e o backup crescem junto. Antes disso: política de arquivamento ou particionamento por mês.

### 6. Menores
- Cache de permissões por réplica (`PermissionsService`, TTL 15 s): na outra réplica, uma mudança de perfil vale em até 15 s. Aceitável.
- `conversations_numberId_contactId_idx` duplica a unique `(numberId, contactId)`: dá para remover numa versão futura (só custa escrita).
- Tudo numa VM só: ponto único de falha (o backup existe, mas não há failover).

## Para 1000 usuários

- **1000 atendentes simultâneos:** API, Socket.io e filas já escalam por réplica. O gargalo era o
  banco (item 1, corrigido) e falta medir o item 2. Teste de carga recomendado antes.
- **1000 empresas:** o limite é a Evolution (item 4) e o volume de mensagens (item 5), não o código da API.

## Ligar pg_stat_statements

O compose já pede `shared_preload_libraries=pg_stat_statements`, mas o Postgres é serviço protegido:
o deploy comum avisa "configuração no compose difere" e **não aplica**. Passo manual, num horário
calmo: o Postgres fica fora por ~10 s e a API e o worker reconectam sozinhos.

```bash
cd /home/ubuntu/atendo
C="docker compose -f infra/docker-compose.prod.yml --env-file .env.production"
$C up -d --no-deps postgres                      # recria só o Postgres (dados no volume)
$C exec postgres sh -c 'psql -U "$POSTGRES_USER" -d atendo -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"'
```

Depois de algumas horas de uso, a leitura (pode ir pelo `scripts/prod/read.sh`):

```sql
select calls, round(total_exec_time) ms_total, round(mean_exec_time::numeric, 1) ms_media, rows, left(query, 160) consulta
from pg_stat_statements order by total_exec_time desc limit 20;
```

Para voltar: tirar os dois `-c` do `command` do Postgres e repetir o `up -d --no-deps postgres`.

## Próximos passos
1. Deploy da migration do item 1 e dos tetos de memória do item 3.
2. Ligar `pg_stat_statements` (seção acima) e investigar o item 2.
3. ~~`mem_limit` nos containers~~ (feito na aplicação; Evolution fica para a próxima troca de imagem dela).
4. Teste de carga em ambiente separado, com números impossíveis (DDD 00).
5. Limpeza de código morto (knip + revisão manual, por módulo).

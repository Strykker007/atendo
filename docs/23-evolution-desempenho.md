# 23 — Evolution: incidente de CPU e manutenção (16/10/2026)

Runbook para continuar o trabalho de 16/10/2026: o que aconteceu, o que já foi feito em produção,
o que está só no repositório e o passo a passo da manutenção da noite. Horários em Brasília
(o servidor está em `-03`; o banco do Atendo grava em UTC).

Acesso: ver memória/`reference-servidor-producao` — `ssh -i ~/.ssh/atendo-prod.key ubuntu@163.176.200.252`.

---

## 1. O que aconteceu

| Horário | Fato |
|---|---|
| ~08:30–09:20 | Servidor (4 núcleos, 24 GB) a 100% de CPU, load 33. `evolution-db` a 266–290%. Mensagens de cliente chegando com atraso (Farmavila, outros) |
| 09:13–09:21 | Criados 3 índices na tabela `Message` da Evolution → `evolution-db` caiu para ~25%, load para 9 |
| ~09:30 | Segundo pico (`evolution-db` 123%) e **conversas travando 8 s ao abrir** |
| 09:38–09:40 | Criados mais 3 índices (formato `#>` do Prisma) → `evolution-db` ~18%, load 2,3, abrir conversa ~1,2 s |

### Causa

A tabela `Message` do banco da Evolution tem **~3,5 mi de linhas (3,2 GB)** e só tinha índice em
`instanceId`. A Evolution procura mensagens por campos de dentro do JSON `key` (`id`, `remoteJid`,
`remoteJidAlt`) — cada busca varria a instância inteira (até **350 mil linhas**, top 5 instâncias
com 200–350 mil). Com 42 números conectados, chegaram a 48 consultas simultâneas de 20–50 s.

Dois geradores de carga:

1. **A própria Evolution**, a cada mensagem/confirmação de entrega/citação:
   `SELECT * FROM "Message" WHERE "instanceId" = $1 AND "key"->>'id' = $2`.
2. **O nosso histórico ao abrir conversa** (`apps/api/src/modules/whatsapp/history-sync.ts` →
   `EvolutionProvider.fetchHistory`, `POST /chat/findMessages`): por abertura, até 2 buscas por id
   + uma por variante do telefone (COUNT + SELECT, `remoteJid OR remoteJidAlt` desde 1970), em até
   3 rodadas. O Prisma da Evolution monta isso como `("key" #> ARRAY['id'])::jsonb = '"..."'`,
   formato que os índices `->>` **não** cobrem. A tela esperava até 8 s (`PRAZO_MS`) — daí o
   "travando ao abrir conversa", sempre 8.0xx ms no log.

`evolution-db` não tinha nenhum limite/prioridade de CPU (a Evolution tem `cpu_shares: 512`, o
banco dela não), então ele tomou a máquina e o painel travou junto.

---

## 2. Já feito em produção ✅

Índices no banco da Evolution, todos com `CREATE INDEX CONCURRENTLY` (sem travar, sem downtime).
Ficam no volume `infra/volumes/evolution-db` — sobrevivem a restart e deploy; **recriar só se o
banco da Evolution for restaurado do zero** (o SQL também está em [04](04-providers-whatsapp.md)).

```sql
CREATE INDEX CONCURRENTLY "Message_instanceId_keyId_idx"            ON "Message" ("instanceId", ("key"->>'id'));
CREATE INDEX CONCURRENTLY "Message_instanceId_remoteJid_idx"        ON "Message" ("instanceId", ("key"->>'remoteJid'));
CREATE INDEX CONCURRENTLY "Message_instanceId_messageTimestamp_idx" ON "Message" ("instanceId", "messageTimestamp");
CREATE INDEX CONCURRENTLY "Message_instanceId_keyIdJson_idx"        ON "Message" ("instanceId", ("key" #> '{id}'));
CREATE INDEX CONCURRENTLY "Message_instanceId_remoteJidJson_idx"    ON "Message" ("instanceId", ("key" #> '{remoteJid}'));
CREATE INDEX CONCURRENTLY "Message_instanceId_remoteJidAltJson_idx" ON "Message" ("instanceId", ("key" #> '{remoteJidAlt}'));
```

Conferido com `EXPLAIN ANALYZE`: busca por id 12 ms → índice; consulta do histórico (BitmapOr nos
dois índices `#>`) 0,1 ms. Com plano genérico o Postgres não usaria o índice `#>`, mas ele só troca
para o genérico quando sai mais barato que o custom (aqui é 27× mais caro) — **não** foi preciso
`plan_cache_mode = force_custom_plan`. Se um dia as consultas `#>` voltarem a aparecer lentas no
`pg_stat_activity`, é o primeiro suspeito.

Nada mais foi alterado em produção (nenhum restart, nenhum cron).

---

## 3. No repositório, sem commit e sem deploy ⏳

Depende de `pnpm typecheck` (usuário) → commit na `develop` → merge/deploy (usuário).

| Arquivo | Mudança |
|---|---|
| `apps/api/src/modules/whatsapp/history-sync.ts` | Teto de **4 buscas de histórico simultâneas** no sistema todo (ZSET `wa:history:running` no Redis; vaga vence junto com a trava de 20 s). Cheio → a conversa abre com o que tem. `PRAZO_MS` 8 s → **3 s** |
| `apps/api/src/modules/whatsapp/providers/evolution.provider.ts` + `provider.interface.ts` | `fetchHistory` devolve `chatIds` e aceita de volta: o JID do chat é descoberto uma vez por busca, não a cada rodada (eram até 6 consultas extras por abertura) |
| `apps/api/src/modules/whatsapp/health.scheduler.ts` | Health check também confere números em `pending_qr` e os promove para `connected` quando a Evolution diz `open` (caso Farmácia Rezende: preso em "aguardando QR" depois de um Reiniciar) |
| `infra/docker-compose.prod.yml` | `evolution-db`: `command: shared_buffers=2GB, effective_cache_size=8GB` |
| `docs/04-providers-whatsapp.md`, `docs/historico-de-mensagens.md` | Documentação das mudanças acima e SQL dos índices |

> No mesmo working tree há mudanças **do usuário** que não são deste incidente
> (`contacts-sync.ts`, `numbers.controller.ts`, `ChatPane.tsx`, `ComposerBar.tsx`, `docs/07`, `docs/08`).
> Commitar só os arquivos da tabela acima.

---

## 4. Manutenção de hoje à noite (16→17/10, 02:00)

Horário escolhido pelo volume das últimas 24 h: 01h–04h têm 1–3 mensagens/hora (pico: 3.800/hora).
O único passo que derruba algo é o restart do `evolution-db` (alguns segundos; a Evolution e as
sessões do WhatsApp continuam de pé).

### 4.1 Antes de começar

```sh
ssh -i ~/.ssh/atendo-prod.key ubuntu@163.176.200.252
uptime
docker stats --no-stream --format "{{.Name}} {{.CPUPerc}}"
docker exec atendo-prod-evolution-db-1 psql -U evolution -d evolution -Atc "show shared_buffers"   # esperado: 128MB
```

### 4.2 Limite de CPU do `evolution-db` (sem restart)

Vale na hora, não derruba conexão. Perde-se se o container for recriado — por isso também vai no compose (4.4).

```sh
docker update --cpus 2 --cpu-shares 512 atendo-prod-evolution-db-1
docker inspect atendo-prod-evolution-db-1 --format '{{.HostConfig.NanoCpus}} {{.HostConfig.CpuShares}}'   # 2000000000 512
```

- `cpus: 2` — teto rígido: nunca passa de 200% (2 dos 4 núcleos). Sobram sempre 2 para API, painel, workers e postgres principal.
- `cpu_shares: 512` — prioridade na disputa: perde para a API (1024) e o postgres principal (2048). Com folga, não muda nada.
- Efeito colateral: no teto, a Evolution demora mais para gravar e avisar o Atendo — atraso restrito ao WhatsApp, o painel segue respondendo. Hoje ele roda a ~18%, o teto é só proteção.

### 4.3 `shared_buffers` 128 MB → 2 GB (restart do `evolution-db`)

Script pronto (gerado em 16/10, sintaxe conferida). Ele aplica com `ALTER SYSTEM` (gravado no
volume, sem mexer nos arquivos do git no servidor), reinicia só o `evolution-db`, espera até 60 s e,
se o banco não voltar, **reverte sozinho** e reinicia com o padrão. Log em
`~/atendo-maint/evolution-db-tune.log`.

Pode rodar à mão às 02:00 (`sh ~/atendo-maint/evolution-db-tune.sh`) ou agendar no cron
(o script remove a própria linha ao rodar):

```sh
mkdir -p ~/atendo-maint
cat > ~/atendo-maint/evolution-db-tune.sh <<'EOF'
#!/bin/sh
# Manutenção agendada: sobe o shared_buffers do banco da Evolution de 128MB para 2GB.
# Roda uma vez pelo cron e se remove. Se o banco não voltar em 60s, desfaz e reinicia de novo.
set -u
C=atendo-prod-evolution-db-1
VOL=/home/ubuntu/atendo/infra/volumes/evolution-db
LOG=/home/ubuntu/atendo-maint/evolution-db-tune.log
exec >>"$LOG" 2>&1
echo "== $(date) início"
crontab -l 2>/dev/null | grep -v evolution-db-tune.sh | crontab -

sql() { docker exec -i "$C" sh -c 'psql -U "$POSTGRES_USER" -d evolution -v ON_ERROR_STOP=1 -At'; }
espera() { for i in $(seq 1 30); do docker exec "$C" pg_isready -U evolution >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

echo "antes: $(echo 'show shared_buffers' | sql)"
echo "ALTER SYSTEM SET shared_buffers = '2GB'; ALTER SYSTEM SET effective_cache_size = '8GB';" | sql || { echo "ALTER SYSTEM falhou, nada mudou"; exit 1; }
docker restart "$C"
if espera; then
  echo "ok: shared_buffers=$(echo 'show shared_buffers' | sql) effective_cache_size=$(echo 'show effective_cache_size' | sql)"
else
  echo "banco não voltou: revertendo"
  docker logs --tail 40 "$C"
  docker run --rm -v "$VOL":/d postgres:16-alpine sh -c "sed -i '/shared_buffers\|effective_cache_size/d' /d/postgresql.auto.conf"
  docker restart "$C"
  espera && echo "revertido, banco de pé com o padrão" || echo "ATENÇÃO: banco da Evolution continua fora"
fi
sleep 30
echo "instâncias conectadas: $(docker exec atendo-prod-evolution-1 sh -c 'wget -qO- --header="apikey: $AUTHENTICATION_API_KEY" http://localhost:8080/instance/fetchInstances' | grep -o '"connectionStatus":"open"' | wc -l)"
echo "== $(date) fim"
EOF
chmod +x ~/atendo-maint/evolution-db-tune.sh

# agendar para 02:00 de 17/10 (fuso do servidor já é -03):
(crontab -l 2>/dev/null; echo "0 2 17 10 * /home/ubuntu/atendo-maint/evolution-db-tune.sh") | crontab -
crontab -l
```

> O `docker restart` mantém o limite de CPU do passo 4.2 (só `docker compose up` recriando o container o descarta).

### 4.4 Deixar permanente no compose

Em `infra/docker-compose.prod.yml`, serviço `evolution-db` (o `command` já está no repo; faltam as duas linhas de CPU):

```yaml
  evolution-db:
    image: postgres:16-alpine
    restart: unless-stopped
    cpus: 2
    cpu_shares: 512
    environment: ...
    # tabela Message com milhões de linhas: com o padrão (128MB) quase nada fica em memória
    command: ["postgres", "-c", "shared_buffers=2GB", "-c", "effective_cache_size=8GB"]
```

O `-c` da linha de comando tem precedência sobre o `ALTER SYSTEM`; os valores são os mesmos, então
não há conflito. Vale no próximo deploy (`docker compose up -d` recria o container).

### 4.5 Conferir (de manhã, ou logo depois)

```sh
cat ~/atendo-maint/evolution-db-tune.log            # "ok: shared_buffers=2GB" e nº de instâncias conectadas
crontab -l                                           # a linha do script deve ter sumido
docker exec atendo-prod-evolution-db-1 psql -U evolution -d evolution -Atc "show shared_buffers"
uptime; docker stats --no-stream --format "{{.Name}} {{.CPUPerc}}"
```

No banco do Atendo, mensagens fluindo (saída e entrada por minuto, horário BRT):

```sql
select to_char(date_trunc('minute',"createdAt")-interval '3 hours','HH24:MI') brt,
  count(*) filter (where direction='out') sai,
  count(*) filter (where direction='out' and status in ('delivered','read')) entregue,
  count(*) filter (where direction='in') entra
from messages where "createdAt" > now()-interval '30 minutes' group by 1 order by 1 desc;
```

E abrir conversa (`GET /conversations/:id/messages`) sem os 8 s:

```sh
for c in atendo-prod-api-1 atendo-prod-api-2; do docker logs --since 10m $c 2>&1 | grep -o "GET /conversations/:id/messages 200 [0-9]*ms"; done | awk '{print $NF}' | sort -n | tail
```

### 4.6 Reverter (se precisar)

```sh
# shared_buffers de volta ao padrão
docker exec atendo-prod-evolution-db-1 psql -U evolution -d evolution -c "ALTER SYSTEM RESET shared_buffers; ALTER SYSTEM RESET effective_cache_size;"
docker restart atendo-prod-evolution-db-1
# limite de CPU
docker update --cpus 0 --cpu-shares 1024 atendo-prod-evolution-db-1
```

Índices: não há motivo para remover (só ocupam disco). Se precisar: `DROP INDEX CONCURRENTLY "<nome>";`.

---

## 5. Ainda em aberto

- [ ] **Commit + deploy** das mudanças da seção 3 (histórico com teto, health check `pending_qr`, compose).
- [ ] **Sincronização de agenda (3º pico, 10:08 BRT)**: em produção roda **a cada 6 h** desde o deploy e cada nome atualizado avisava todos os painéis (~1.860 avisos em 2 min → milhares de `GET /conversations`/`counts`). Corrigido no repo (sem commit): cron fixo 03:00 `America/Sao_Paulo`, um aviso por conversa no fim do lote, nomes normalizados (espaço duplo deixava de ser "mudança"); testes `contacts-sync.test.ts`/`contact-name.test.ts` passando. Até o deploy, o pico se repete a cada 6 h (~16:08, ~22:08, ~04:08).
- [ ] **46 jobs `delayed` na fila `wa-inbound`** (visto às ~09:30): conferir se são mensagens de cliente que falharam no pico e estão em retentativa — garantir que nenhuma se perdeu.
- [ ] **Drogaria Balneário, "cEL 5196"**: removido pelo WhatsApp às 09:25 (401 / LOGOUT). Precisa ler o QR de novo, respeitando a pausa de reconexão; 1 mensagem parada na fila desde 09:20.
- [ ] **Crescimento da `Message` da Evolution**: só cresce (nós já guardamos as mensagens no nosso banco). Avaliar limpeza de mensagens antigas (ex.: > 90 dias) — antes, medir impacto no histórico ao rolar a conversa e na citação/apagar/editar, que usam o `findMessages`.

## 6. Decisão: máquina separada para a Evolution

**Agora não.** O pico foi falta de índice, não de máquina: com os índices o `evolution-db` roda a
~18% e o servidor fica 60–70% ocioso. Separar traria IP novo para as 42 sessões (reconexão em
massa de IP diferente é sinal que o WhatsApp pune), rede/TLS entre máquinas para o webhook
(hoje `http://api:4000` interno), backup e monitoramento duplicados e custo. O isolamento que
importava (a Evolution não derrubar o painel) vem do limite de CPU do passo 4.2.

**Quando reavaliar:** CPU sustentada acima de 60% mesmo com os índices, ou ~100 números
conectados. O código já suporta: `EvolutionProvider.shard(ctx)` aceita `baseUrl`/`apiKey` por
número — dá para subir uma segunda Evolution e mandar para ela só os números **novos**, sem migrar
os atuais.

---

## 7. 17/10/2026 — novo pico de manhã (carga 8 às 09:18, sábado)

`shared_buffers` 2 GB já estava valendo (o deploy da v1.4.0 recriou o `evolution-db` às 11:15 de
16/10). Na última hora, com 78 usuários: 27,6 mil `GET /media`, 15,2 mil `GET /conversations/counts`,
10 mil `GET /conversations`, 7,2 mil `GET /conversations/:id/flow`. Era o painel recarregando demais:

| Causa | Correção |
|---|---|
| `StorageService.signedUrl` vencia no segundo exato: cada resposta gerava URL nova para cada foto e o navegador nunca usava o cache | vencimento arredondado para a próxima janela de 30 min — a mesma foto devolve a mesma URL por meia hora |
| evento `conversation` (a cada mensagem de qualquer conversa do cliente) recarregava lista, contagens e quadro em todo painel aberto | `lib/hooks/numeros.ts`: lista/contagens/quadro recarregam no máximo 1 vez a cada 2 s; a conversa aberta segue imediata |
| fluxo ativo da conversa aberta consultado a cada 15 s | 60 s (o websocket já invalida a cada evento da conversa) |
| backup a cada 24 h desde a subida do container — rodava às 13:38, `pg_dump` de GBs nos bancos em pleno expediente | horário fixo `BACKUP_AT` (03:30) via `infra/backup/agenda.sh` |
| `evolution-db` sem teto de CPU | `cpus: 2`, `cpu_shares: 512` no compose (sai do passo 4.2 manual) |

Também: **build das imagens roda no próprio servidor** no deploy (16/10: ~11:15–11:34), o que leva a
CPU a 100% por minutos. Mover o build para fora (GitHub Actions + registry) ainda está em aberto.

---

## 8. 17/10/2026 — Drog. Kelly I, socket zumbi (11:12)

"DROGARIA KELLY 1" parou de receber e de ter confirmação às 11:12 com a Evolution dizendo `open`;
dois "Reiniciar" (13:47) não fizeram nada — o patch do restart via `ws.isOpen` verdadeiro no zumbi.
Só o QR resolve na versão em produção. Corrigido no repo: restart força socket novo quando o objeto
`client` não mudou (`infra/evolution/patch-evolution-restart.mjs`) e o health check ganhou a regra
de silêncio anormal. **Deploy do patch exige rebuild da imagem da Evolution + restart do container
(todos os números reconectam): fazer de madrugada.**


---

## 9. 19/10/2026 — queda em massa às 17:19 (cache `IsOnWhatsapp`)

**Sintoma:** às 17:19:12 uns 25 números caíram no mesmo segundo e ficaram em `connecting` na
Evolution ("QR pendente" no painel), sem ninguém desconectar. Load do servidor em 40–44 (4 CPUs),
`evolution-db` no teto de 2 CPUs com ~40 consultas iguais ativas. O 1-MSA 4968 entrou em tempestade
de reconexão (428/440 a cada segundo) às 17:23 — a guarda do doc 29 não está em produção.

**Causa:** o `.env` embutido na imagem da Evolution (`/evolution/.env`) liga
`DATABASE_SAVE_IS_ON_WHATSAPP=true`. A cada mensagem e a cada contato sincronizado, `saveOnWhatsappCache`
faz `findFirst` com `"jidOptions"::text LIKE '%<número>@s.whatsapp.net%' OR … OR "remoteJid" = …` —
leitura da tabela inteira (182 mil linhas, até 2,3 s sob carga). Com muitos números reconectando, a
sincronização de contatos multiplica a consulta; a carga derruba mais sockets, que reconectam e
sincronizam de novo — ciclo.

**O que foi feito em produção (19/10, ~17:40–17:51):**

| Passo | Resultado | Reverter |
|---|---|---|
| `CREATE EXTENSION pg_trgm` + índice GIN `IsOnWhatsapp_jidOptions_trgm` em `"jidOptions"` | pouco efeito: o sufixo `@s.whatsapp.net` está em toda linha e o planejador segue preferindo a leitura completa | `DROP INDEX CONCURRENTLY "IsOnWhatsapp_jidOptions_trgm"` |
| `ALTER COLUMN "jidOptions" SET STATISTICS 1000` | só planejamento | `SET STATISTICS -1` |
| `ALTER SYSTEM SET random_page_cost = 1.1` + `pg_reload_conf()` | valor de SSD; o banco prefere índices em geral | `ALTER SYSTEM RESET random_page_cost; SELECT pg_reload_conf();` |
| Cópia `IsOnWhatsapp_bkp_20261019` (182.309 linhas) + `TRUNCATE "IsOnWhatsapp"` | `evolution-db` de 200% para ~25% de CPU na hora | `INSERT INTO "IsOnWhatsapp" SELECT * FROM "IsOnWhatsapp_bkp_20261019" ON CONFLICT DO NOTHING` |

O `IsOnWhatsapp` é só cache: o código lê na consulta "esse número tem WhatsApp?" (`whatsappNumbers`)
e grava a cada mensagem/contato. Sem a linha, a Evolution pergunta ao WhatsApp. O mapeamento LID das
mensagens fica no Baileys. A tabela volta a crescer (~3 mil linhas/30 min) até a correção abaixo.

**Correção definitiva (no repo, sem deploy):** `DATABASE_SAVE_IS_ON_WHATSAPP: "false"` nos dois
compose — variável de ambiente vence o `.env` da imagem. Exige recriar o container da Evolution
(todos os números reconectam): fazer no deploy noturno da Evolution, junto com a `v2.3.7-atendo.4`
(produção ainda roda `v2.3.7-biz`, sem a guarda de conexão nem o patch da CVE). Depois, apagar a
`IsOnWhatsapp_bkp_20261019`.

**Hotfix aplicado (19/10, 22:23):** como a `atendo.4` ainda não passou pelo teste com WhatsApp real,
a variável foi aplicada antes, na **mesma** imagem `v2.3.7-biz`, por um override fora do git
(`~/atendo/infra/docker-compose.evolution-hotfix.yml`) e `up -d --no-deps --no-build evolution`.
Antes: backup `/backup/evolution-pre-hotfix-20261019.dump` (926 MB) + `BGSAVE` do Redis; dry-run
conferido (única diferença: a variável). Resultado: 45 abertas antes, 45 depois; carga 3,4; nenhuma
consulta ao `IsOnWhatsapp`; um `bad-mac`/428 na Drogam Farma, reconectada sozinha em 4 s. O override
sai quando a `atendo.4` for implantada pelo `scripts/deploy-evolution.sh` (o compose principal já
traz a variável; sem o `-f` do override, o compose volta a pedir a imagem do repositório).

**Pareamento perdido (15 números) — defeito da Evolution 2.3.7.** Às 17:19 esses números fecharam
com código 200 (sem 401) e 3 s depois já emitiam QR: `registered: false`, sem `me` na `Session`. No
`useMultiFileAuthStatePrisma` da Evolution, a leitura da sessão engole qualquer erro (`catch{return
null}`) e o chamador faz `creds = lidas || initAuthCreds()` **e grava** — com o banco estourando o
tempo (`PrismaClientKnownRequestError` às 17:18), a credencial pareada foi sobrescrita por uma nova.
O aparelho continua vinculado no celular; só a credencial local se perdeu. `POST /instance/restart`
não resolve (leva a `close`); `GET /instance/connect` devolve QR. Saídas: ler o QR de novo, ou
restaurar a credencial da `Session` do backup das 09:40 (`/backup/20261019-124021/evolution.dump`)
só nas instâncias ainda `registered: false`, seguida de `connect` — nunca `logout`.
Removidos de fato pelo WhatsApp (401) na tempestade: Amor Por Vidas "FIXO" (17:48) e
`atendo-cd454fd7-5561994309`.

**Restauração (19/10, 18:09–18:18):** credencial da `Session` do backup das 09:40 copiada para
`"Session_bkp_20261019"` e aplicada só em instância sem `me` (atenção: `registered` é `false` também
nas pareadas por QR — não serve de critério), seguida de `restart` (ciclo de QR) ou `connect` (close).
9 voltaram sem QR e recebendo; Farmácia Economize e DROGARIA KELLY 1 foram recusadas pelo WhatsApp
(401 — aparelho já desvinculado) e precisam de QR. A Economize teve o QR em andamento interrompido pela
restauração e depois caiu no limite de vínculos do WhatsApp ("tente mais tarde"). Apagar
`"Session_bkp_20261019"` (contém credenciais) quando estabilizar.

**Corrigido no repo:** `infra/evolution/patch-evolution-creds-read.mjs` — com a leitura vazia, confirma
no banco que a sessão não existe antes de criar credencial; existe ou o banco não responde → erro, nada
gravado, e a guarda tenta de novo (`create_failed`, backoff). Testado no build (`verify-patches.test.mjs`).

---

## 10. 19/10/2026 — "conectado, envia, não recebe": causa no Baileys rc.9

Balneário (4ª vez), Marttins e Drog. Kelly I: a Evolution dizia `open`, a sonda respondia, o envio
saía, e nada chegava — nem mensagem, nem confirmação de entrega. Na tabela `Message` da própria
Evolution também não havia nada: o WhatsApp não estava entregando para aquele socket. Reiniciar não
resolvia; ler o QR resolvia.

**Causa (código do `messages-recv.js` do 7.0.0-rc.9):**
- mensagens, recibos e notificações passam por UMA fila serial (`processingMutex`) sem prazo — uma
  tarefa que não termina segura tudo, em silêncio, enquanto envio e consultas (fora da fila) funcionam;
- o processador de nós offline faz `await nodeProcessor(node)` sem `try`: uma exceção (vista hoje:
  `rate-overlimit` às 11:36, 12:26 e 12:55) deixa `isProcessing = true` até o socket fechar;
- mensagem que falha no processamento fica **sem ack** (o `catch` só loga), e o servidor a reentrega a
  cada reconexão — o mesmo nó volta a travar o socket novo; o QR cria aparelho novo, sem essa fila.
- gatilho nos logs: `error in handling message` em mensagens `category='peer'` (do próprio celular da
  loja) — Balneário no segundo exato do QR de 11:07:48 e 10 min antes da remoção de 18/10; Marttins no
  segundo do QR de 18/10. Os nomes saíram do `verified_name` em hex: o log do Baileys não dizia a instância.
- upstream: rc.10 traz "Fix connection deadlocks", "Mutex redesign", "Proper ack handling", "improved
  offline node batching"; issue WhiskeySockets/Baileys#2132 ("online, mas não envia nem recebe", rc.9).

**Correção (imagem `v2.3.7-atendo.4`, sem trocar versões):**

| Patch | O quê |
|---|---|
| `patch-baileys-recv.mjs` | prazo de 120 s (`ATENDO_RECV_TASK_TIMEOUT_MS`) por tarefa da fila de processamento e da de retry — travou, registra `[atendo] tarefa travada` e a fila segue; loop offline continua depois de erro; NACK `UnhandledError` para mensagem que falha sem ter recebido recibo (inclusive erro antes do `try` original: decodificação, migração de LID) |
| `patch-evolution-baileys-logger.mjs` | `.child({instance})` no logger do socket e do key store: toda linha do Baileys diz o número |
| `patch-evolution-creds-read.mjs` | ver § 9 |

Testes no build (`verify-patches.test.mjs`): fila com tarefa travada libera a seguinte; erro na tarefa
chega a quem chamou; nó offline com erro não para os seguintes; NACK só sem recibo; credencial nos
quatro casos (lida, leitura falhou, banco fora, instância nova) nos dois bundles.

**Produção** ainda roda `v2.3.7-biz` (sem guarda de conexão, CVE nem estes patches). Deploy:
`scripts/deploy-evolution.sh` (doc 27) à noite — todos os números reconectam, com a guarda escalonando.

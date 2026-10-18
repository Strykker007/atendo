# 30 — Testes locais da estabilização da Evolution

Valida as etapas 1–3 (docs [27](27-deploy-evolution.md), [28](28-estabilizacao-conexao.md),
[29](29-reconexao-evolution.md)) no **ambiente de desenvolvimento que já roda na sua máquina**: sem
servidor novo, sem homologação paralela, sem número de cliente.

## 1. O ambiente local (o que o repositório define)

`pnpm start:all` (`scripts/up.sh`) sobe tudo na máquina:

| Serviço | Onde roda | Endereço | Origem |
|---|---|---|---|
| API do Atendo | processo Node local (`nest start --watch`) | `localhost:4000` | `apps/api` |
| Workers (filas) | **o mesmo processo da API** em dev (os processors são registrados juntos) | — | `apps/api` |
| Web | processo Node local | `localhost:3000` | `apps/web` |
| PostgreSQL do Atendo | container (`infra/docker-compose.yml`) | `localhost:5433` | volume `infra/volumes/postgres` |
| Redis (BullMQ + cache **e chaves Signal da Evolution**, db 6) | container | `localhost:6379` | volume `infra/volumes/redis` |
| Evolution API | container, imagem `atendo/evolution-api:v2.3.7-atendo.3` (build de `infra/evolution`) | `localhost:8080` | volume `infra/volumes/evolution` |
| Postgres da Evolution | container | só na rede do compose | volume `infra/volumes/evolution-db` |
| Webhooks | Evolution → `http://host.docker.internal:4000/webhooks/evolution` (a API local) | — | compose de dev |

**Dependência de produção:** nenhuma no que o repositório define. O `.env.example` só tem
`localhost`, e nada no compose de dev aponta para fora. O que pode existir **no seu `.env`** e o
repositório não controla: chaves reais de Stripe, Resend e IA. Os testes não usam nenhuma delas,
porque o tenant sintético não tem fluxos, IA nem campanhas. `scripts/prod-query.sh` (acesso a
produção, fora do git) não é chamado por nenhum teste.

**Travas antes de qualquer teste:**
- `scripts/test/local.sh` e `apps/api/scripts/loadtest.ts` **recusam rodar** se
  `DATABASE_URL`, `REDIS_URL`, `EVOLUTION_BASE_URL` ou a URL da API não forem `localhost`, ou se
  `NODE_ENV=production`.
- A carga usa um **tenant próprio** (`loadtest-sintetico`) e um número sintético inativo, que fica
  fora do health check e da sincronização de agenda. Esse número aponta para `http://127.0.0.1:9`:
  qualquer chamada do worker ao provider (foto, mídia, envio) falha na hora, localmente.
  - Telefones `5500…` (DDD 00 não existe).
  - Os dados do tenant sintético são apagados no fim (`--keep` mantém).
- O laboratório de reconexão usa uma **Evolution descartável** (`atendo-evo-lab`, porta 18080),
  com banco, Redis e volumes efêmeros. Nunca toca no stack de dev nem nas sessões dele.
- Nenhuma mensagem sai pela rede do WhatsApp nos testes automáticos.

> Antes do teste real (parte 3), confira que a Evolution de dev não tem sessão de cliente:
> `curl -s localhost:8080/instance/fetchInstances -H "apikey: $EVOLUTION_API_KEY" | grep -o '"name":"[^"]*"'`.

## 2. Comandos

```sh
pnpm start:all                       # stack de dev (como sempre)
# para medir memória/event loop da API: DIAG_STATS_MS=1000 no .env e reinicie a API

pnpm test:local                      # mocks da guarda + testes da API + carga 100/500/1000
pnpm test:local -- --quick           # carga só com 100
pnpm test:local -- --lab             # + laboratório de reconexão (precisa de autorização: rede)

# avulsos
pnpm --filter @atendo/api loadtest -- --messages 1000 --contacts 100 --concurrency 30 --dup 0.2
bash scripts/test/evolution-lab.sh compare 120 10     # antes × depois, DNS fora, 10 instâncias
bash scripts/test/evolution-real-check.sh <instância> # coleta do teste com WhatsApp real (só lê)
```

Relatório consolidado em `.reports/local-<data>.md` (fora do git), em três seções que não se
misturam: **1. Simulado**, **2. Laboratório** e **3. WhatsApp real**.

### O que cada parte mede

| Parte | Como | Mede |
|---|---|---|
| Guarda — mocks | `node --test infra/evolution/test/connection-guard.test.mjs` (relógio falso) | 408, 428, 440, 515, DNS, concorrência, dois restarts, socket antigo atrasado, recuperação, cancelamento, 50 instâncias juntas, credenciais intactas |
| API | vitest: `connection-stability` + `evolution.provider`; o Lua roda contra o Redis local, só com chaves `wa:conn:*:teste-*` | ordem do `connection.update`, prazos, códigos 401/402/403/406, sonda |
| Carga sintética | `loadtest.ts`: POST no formato da Evolution 2.3.7 direto na API | **A.** recebimento, processamento, latência ponta a ponta (`queuedAt` − envio), vazão, concorrência (1 contato e 1 conversa por telefone), idempotência com duplicadas, ordem (`lastMessageAt` = mensagem mais nova). **B.** status `SERVER_ACK`/`DELIVERY_ACK`/`READ` embaralhados (não pode regredir). **C.** webhook inválido (401/400/instância desconhecida). **D.** fila parada e retomada: nada processado, nada perdido, tempo para drenar. **E.** `connection.update` com carimbo fora de ordem. Mais: jobs falhos, `/health` sob carga, pico da fila e memória/event loop da API (`DIAG_STATS_MS`) |
| Laboratório | `evolution-lab.sh` | `dns`/`timeout`/`compare`: tentativas por segundo antes × depois, com credenciais inalteradas. `recovery`: tempo até voltar quando a rede volta. `concurrency`: 10 connects + 3 restarts simultâneos → quantos sockets. Memória/event loop da Evolution (`ATENDO_STATS_MS`, evento `process.stats` da guarda) |

Os erros 408/428/440/515 **específicos** só são reproduzíveis com mock (guarda). O laboratório produz
os reais que o ambiente gera: DNS/recusa (chega como 408), timeout e TLS (500).

## 3. Teste com WhatsApp real — roteiro (precisa de autorização)

**Dois chips seus:** o **A** é o número de teste, conectado à Evolution local; o **B** só conversa
com o A. Nada de número de cliente, e poucas mensagens.

0. Se a Evolution de dev ainda é a imagem antiga:
   `docker compose -f infra/docker-compose.yml --env-file .env build evolution && docker compose -f infra/docker-compose.yml --env-file .env up -d evolution`.
   Isso recria **só a Evolution de dev**: as sessões dela reconectam sem QR.
1. **Pareamento:** no painel local (`demo@atendo.local`) → Números → Conectar → ler o QR com o A.
   Esperado: `515` → reconexão em < 1 s → `open`. Depois, `evolution-real-check.sh <instância>`.
2. **Mensagens:** B → A (3 mensagens, uma com foto); A → B pelo painel (2); e uma resposta digitada
   no celular A. Esperado: tudo no painel, status entregue/lida no B, a do celular como "enviada
   pelo celular".
3. **Histórico:** o lote do QR chega (conversas antigas do A aparecem ao abrir). Isso confirma que o
   backport `5ddc231` não bloqueou o sync legítimo. No coletor, `dropping spoofed` = 0.
4. **Reinício controlado:** "Reiniciar conexão" no painel duas vezes seguidas. Esperado: um socket
   novo, 429 no segundo clique e mensagens fluindo depois, sem QR.
5. **Persistência:** `docker compose -f infra/docker-compose.yml --env-file .env restart evolution`.
   Esperado: volta `open` sem QR; a coleta mostra `Session` = 1 e as chaves no Redis.
6. **Reconexão** (opcional; desconecta a rede da máquina): Wi-Fi desligado por 2 min. Esperado: no
   coletor, degraus crescentes e depois `reconnect.recovered`; nada de QR.
7. Rodar o coletor a cada passo e guardar os `real-*.md` gerados.

## 4. Critérios para aprovar a ETAPA 3

| # | Critério | Onde se vê |
|---|---|---|
| 1 | Mocks da guarda: 20/20 | `pnpm test:local`, linha `guard` |
| 2 | Build da imagem `.3` com os 43 testes passando | `docker compose … build evolution` |
| 3 | Laboratório `compare`: a nova faz **≤ 0,1 tentativa/s por instância** (antes: ~16/s) e as credenciais ficam inalteradas | relatório, seção 2 |
| 4 | `concurrency`: **1** socket para 10 connects + 3 restarts | seção 2 |
| 5 | `recovery`: volta sozinha, sem QR, em **≤ 5 min** depois de a rede voltar | seção 2 |
| 6 | Carga 1.000: recebidos, processados, idempotência, concorrência, webhooks inválidos, pausa/retomada e ordem do `connection.update` **todos ✔**, e **0 jobs falhos** | seção 1 |
| 7 | WhatsApp real, passos 1–5: sem QR depois do pareamento, sem `stale.dropped` seguido de 440, `dropping spoofed` = 0, histórico chegando | seção 3 |

## 5. Achados da primeira execução (sandbox de desenvolvimento, 18/10/2026)

A ferramenta foi validada num ambiente igual ao local (Postgres 5433, Redis 6379, API em modo dev,
`DIAG_STATS_MS=1000`). Os números de desempenho valem **só como referência daquela máquina**; os que
contam são os da sua.

| Mensagens | Verificações | Ponta a ponta p50 / p95 | Vazão | Retomada (50) | RSS máx | Event loop p99 máx |
|---|---|---|---|---|---|---|
| 100 | 12/14 | 0,6–0,9 s / 1,1–1,5 s | 41–44/s | 0,5–0,8 s | 247 MB | 41 ms |
| 500 | 13/14 | 3,1 s / 5,1 s | 81/s | — | 262 MB | 31 ms |
| 1.000 | 12/14 | 5,7 s / 9,5 s | 86/s | — | 376 MB | 27 ms |

Recebimento, idempotência, concorrência, webhooks inválidos, pausa/retomada e ordem do
`connection.update` passaram em todas. **Duas falhas reais do Atendo**, que existem também em
produção e **não** são da Evolution:

1. **`lastMessageAt` regride com mensagens processadas fora de ordem.**
   - Em 1.000 mensagens, 91 de 100 conversas ficaram com o horário de uma mensagem mais velha.
   - Causa: `conversations/inbound.service.ts` (~l. 177) grava `lastInboundAt`, `lastMessageAt` e
     `lastMessagePreview` sempre com a mensagem que está sendo processada. A fila roda 20 em
     paralelo e a Evolution manda os webhooks em paralelo.
   - Efeito: ordem da lista de conversas, prévia e "aguardando desde".
   - Correção proposta: só avançar quando `msg.timestamp` for maior que o atual (update
     condicional).
2. **Status pode regredir com confirmações concorrentes.**
   - De 1 a 3 em 50 terminaram como "entregue" depois de "lida".
   - Causa: `applyStatus` (~l. 393) lê e depois grava, sem atomicidade. "Entregue" e "lida"
     processados juntos leem `sent` e o último a gravar vence.
   - Correção proposta: `updateMany` condicional ao status atual ser mais baixo.

As duas correções aguardam autorização.

# 24 — Auditoria técnica: Evolution API, estabilidade e viabilidade de migração (18/10/2026)

Escopo: banimentos (A), desconexões (B) e webhooks travando (C) nos números **QR / Conexão Web**.
Base da análise: código deste repositório, `infra/`, docs 04/23/envio, e o **código-fonte da
Evolution 2.3.7** (tag `2.3.7`, commit `cd800f2`) e da **2.4.0-rc2**, lidos linha a linha. As
referências `evo:` apontam para arquivos da Evolution 2.3.7; as demais, para este repositório.

**Limite desta auditoria:** não tive acesso aos logs nem aos bancos de produção. Tudo o que
depende de log está marcado como **hipótese** ou **provável**, com o comando que confirma ou
derruba (seção 8). Nenhuma conclusão sobre um banimento específico sai daqui sem essa conferência.

Legenda: ✅ **confirmado** (lido no código/config, o mecanismo existe) · 🟡 **provável**
(mecanismo confirmado + sintoma compatível com incidentes documentados, falta o log) ·
🔵 **hipótese** (plausível, não validada).

---

## 1. Resumo executivo

1. **A instalação tem defeitos próprios que explicam boa parte de B e C**, independentemente
   da Meta. Os mais graves:
   - ✅ As **chaves Signal de todas as sessões** (pre-keys, sessões por contato, app-state) ficam
     no **mesmo Redis do BullMQ** (`maxmemory 512mb`, `noeviction`), **fora do backup**, e falha
     de escrita é engolida em silêncio. Redis cheio = chave não gravada = "Bad MAC"/"No session
     record" = mensagem descartada sem webhook (o quadro "parou de receber").
   - ✅ A imagem da Evolution embute o `.env.example` como `.env`: **~20 tipos de evento que o
     Atendo ignora** (`messages.set`, `chats.*`, `send.message`, `contacts.set`, `call`,
     `labels.*`…) são entregues, enfileirados com o corpo inteiro (até 30 MB) e guardados no Redis
     (1.000 concluídos + 5.000 falhos), disputando a mesma memória das chaves Signal.
   - ✅ Na 2.3.7, **qualquer falha de banco dentro do `messages.upsert` aborta o lote inteiro sem
     webhook** e **a fila de eventos de cada instância é serial**: um `await` lento (pool do
     Prisma, webhook de edição com retentativa de até ~30 min) trava todos os eventos daquele número.
   - ✅ Há **caminhos que criam dois sockets para a mesma sessão** (patch do restart, restart
     manual sem trava, `connect` em estado `connecting`). O WhatsApp derruba um com `440
     conflict/replaced`, a Evolution reconecta **na hora, sem backoff**, e o ciclo pode se repetir.
   - ✅ A Evolution 2.3.7 **não emite nem registra** o motivo das quedas que ela reconecta sozinha
     (408, 428, 440, 500, 515). Com `LOG_LEVEL=ERROR,WARN` hoje **é impossível distinguir**
     timeout, troca de socket e reinício pedido pelo servidor. "A Meta derrubou" não está provado
     em nenhum dos casos — falta o dado.
2. **Banimentos (A):** o risco estrutural é o próprio modelo QR (cliente WhatsApp Web não oficial,
   proibido pelos Termos). As defesas de ritmo já implementadas são boas; os pontos que ainda
   pesam são o **envio frio/automático em número QR**, **re-pareamentos frequentes** e o
   **comportamento de conexão anômalo** (loops de reconexão, sockets duplicados, pairing code
   repetido) — este último é hipótese, sem prova de que a Meta o puna.
3. **Não atualizar para a 2.4.0-rc2**: ✅ ela passou a tratar `408` como queda definitiva e
   **apaga as credenciais** (exige QR) — é exatamente a regressão do PR #2612.
4. **Recomendação:** (a) agora — **corrigir a instalação** (seção 7, P0), mantendo a 2.3.7 com
   patches no build; (b) em paralelo — **arquitetura híbrida**, migrando para a **Cloud API
   oficial** os números com automação, campanha e volume (o adapter `MetaProvider` e a troca de
   provider já existem); (c) **não** reescrever sobre Baileys nem trocar por outra solução não
   oficial esperando menos banimento: é o mesmo protocolo e o mesmo risco.

---

## 2. Inventário da implementação atual

| # | Item | O que é hoje | Evidência |
|---|---|---|---|
| 1 | Versão Evolution | **2.3.7** + 2 patches (nó `<biz>`, restart) | `infra/evolution/Dockerfile:6` |
| 1 | Versão Baileys | **7.0.0-rc.9** (fixada pela Evolution); versão do protocolo WA Web buscada **a cada conexão** em `web.whatsapp.com/sw.js` | `evo: package.json:80`, `evo: whatsapp.baileys.service.ts:594`, `evo: src/utils/fetchLatestWaWebVersion.ts` |
| 2 | Topologia | 1 host (4 núcleos, 24 GB): `api`×2, `worker`×2, `web`, `caddy`, `postgres`, **`redis` (compartilhado)**, **1 `evolution`** (todas as ~42 instâncias num processo Node), `evolution-db`, `backup` | `infra/docker-compose.prod.yml` |
| 3 | Sessões | `creds` no Postgres da Evolution (tabela `Session`); **chaves Signal no Redis** `redis://redis:6379/6` (hash por instância) porque `CACHE_REDIS_ENABLED=true` | `evo: src/utils/use-multi-file-auth-state-prisma.ts:91-103`; compose `CACHE_REDIS_*` |
| 4 | Reconexão | Evolution: reconecta imediatamente em todo `close` exceto 401/403/402/406. Atendo: restart automático em `Connection Closed` (1 a cada 2 min por número), restart manual, health check a cada 5 min, detecção de "parou de receber" | `evo: whatsapp.baileys.service.ts:426-468`; `outbound.processor.ts:203-207`; `numbers.service.ts:69`; `health.scheduler.ts` |
| 5 | Webhook | Evolution → `POST http://api:4000/webhooks/evolution` (global) → valida HMAC do `apikey` → `wa-inbound` (BullMQ, 5 tentativas) → `InboundProcessor` (concorrência 10 × 2 workers) | `webhooks.controller.ts:42-56`; `whatsapp.module.ts:27`; `inbound.processor.ts:19` |
| 6 | Redis / Postgres / filas | Redis único: BullMQ + pacer/cotas do Atendo + cache **e chaves Signal** da Evolution. Postgres do Atendo e Postgres da Evolution separados. Sem RabbitMQ | compose; `evo .env.example:77` |
| 7 | Anti-bloqueio | ritmo sorteado por número, Lua atômico; teto de automáticas/h; aquecimento por sessão (7 dias); cota de 10 contatos frios/dia; automático frio recusado; campanhas QR com aceite, 20–60 s, 200/24 h, horário comercial; checagem de "tem WhatsApp"; opt-out; pausa de reconexão após 401; online só durante atividade; checklist antes do QR | `docs/envio.md`, `docs/04` › Proteção; `number-warmup.ts`; `number-removal.ts` |
| 8 | Monitoramento | log estruturado + Sentry no Atendo; Evolution `LOG_LEVEL=ERROR,WARN`, `LOG_BAILEYS=error`; sem métricas (Prometheus) nem alerta de fila/Redis | `docs/14` › O que ainda falta |
| 9 | Ponto único de falha | 1 host, 1 processo Evolution, 1 Redis sem réplica (e fora do backup para as chaves), 1 Postgres da Evolution | compose; `infra/backup/backup.sh` (não copia Redis) |

---

## 3. Problema B — Desconexões: o que o código mostra

### 3.1 Como a Evolution 2.3.7 trata cada código (`evo: whatsapp.baileys.service.ts:426-468`)

| Código (Baileys `DisconnectReason`) | Significado no protocolo | 2.3.7 faz | Webhook ao Atendo | Atendo faz |
|---|---|---|---|---|
| **401** loggedOut | sessão revogada: removida no celular, `device_removed`, ou após logout | não reconecta; `logout.instance` → `cleaningUp` **apaga `creds`** | `connection.update` `close` + `statusReason: 401` | marca queda + pausa (`number-removal.ts`) |
| **403** forbidden | conta proibida/banida ou acesso negado | não reconecta; apaga `creds` | `close` + `403` | ✅ **trata como desconexão comum** — `loggedOut` só olha 401 (`evolution.provider.ts:527`); sem pausa, o cliente pode re-parear na hora |
| 402 / 406 | (raros; 406 aparece em ban/"not acceptable") | não reconecta; apaga `creds` | `close` + código | igual ao 403 |
| **408** timedOut / connectionLost | keep-alive sem resposta, rede | **reconecta na hora** | ❌ nenhum `close`; só `connecting` → `open` | `connecting` ignorado se já conectado |
| **428** connectionClosed | socket fechado localmente/sem conexão | reconecta na hora | ❌ | envio falha "Connection Closed" → restart automático |
| **440** connectionReplaced | **outra sessão com as mesmas credenciais** abriu | reconecta na hora (**sem backoff**) | ❌ | nada |
| 500 badSession | sessão corrompida | reconecta | ❌ | nada |
| **515** restartRequired | servidor pede reinício (normal logo após parear) | reconecta | ❌ | nada |

Consequências:

- ✅ **Os logs não permitem dizer quem fechou.** O ramo de reconexão não loga `statusCode`, e o
  `connection.update` de `close` só sai para 401/403/402/406. `LOG_LEVEL=ERROR,WARN` também esconde
  o "CONNECTED TO WHATSAPP" (INFO). O que aparece é o `stream errored out` do Baileys (nível error),
  que diz o `<stream:error code=…>` — esse é o único rastro do motivo.
- ✅ **Fechamento remoto ≠ bloqueio.** 408/428 podem ser rede, host suspenso, event loop travado
  (keep-alive de 30 s não respondido) ou o próprio processo; 515 é rotina; 440 quase sempre é
  **nossa** sessão duplicada. Só 401/403 (e o que o celular mostra) indicam ação sobre a conta.
- ✅ O motivo da última queda definitiva fica gravado em `evolution."Instance".disconnectionReasonCode`
  e `disconnectionObject` (`evo: …service.ts:446-455`) — fonte forense que ninguém consulta hoje.

### 3.2 Reconexões concorrentes e sockets duplicados

| Achado | Evidência | Classe |
|---|---|---|
| `createClient` **sobrescreve `this.client` sem encerrar o socket anterior** e registra novos handlers; os handlers do socket antigo continuam vivos e, ao fechar, chamam `connectToWhatsapp` de novo | `evo: whatsapp.baileys.service.ts:696-698, 1875-1906` | ✅ |
| Reconexão do `close` é imediata, sem trava por instância nem backoff | `evo: …service.ts:430-431` | ✅ |
| **Patch do restart**: fecha o socket, espera 3 s e, se `client` ainda é o mesmo objeto, chama `connectToWhatsapp`. Mas o `close` do socket fechado **também** dispara a reconexão nativa, e `createClient` leva mais de 3 s quando o banco está lento (`defineAuthState`) ou o `sw.js` do WhatsApp demora (`fetchLatestWaWebVersion`, até o timeout do axios). Resultado: **dois `createClient` em paralelo** com as mesmas credenciais | `infra/evolution/patch-evolution-restart.mjs:20`; `evo: …service.ts:576-598` | ✅ mecanismo · 🟡 ocorrência |
| Restart **manual** (`POST /numbers/:id/restart`) não passa por `claimRestart`; dois cliques, ou clique + restart automático, = dois restarts simultâneos | `numbers.controller.ts:268-278` | ✅ |
| Restart automático dispara em `428 Connection Closed`, que também ocorre **durante uma reconexão normal** (515/408 em andamento) → restart sobre reconexão em curso | `outbound.processor.ts:205` | ✅ mecanismo · 🔵 frequência |
| `connect()` do Atendo, com estado `connecting`, chama `/instance/create` e `/instance/connect`; e com `close` faz `logout` **que a 2.3.7 recusa** ("instance is not connected", 400, engolido pelo `.catch`). As credenciais **não** são descartadas — ao contrário do que diz o doc 04 — e o `connect` reconecta com as antigas | `evolution.provider.ts:67-87`; `evo: instance.controller.ts:309-339, 436-450` | ✅ |
| Sessão duplicada → `440` → reconexão imediata das duas → **ping-pong** até uma desistir; cada troca reescreve chaves Signal em paralelo (risco de corromper → "Bad MAC") | combinação dos itens acima | 🟡 |
| Vários **processos** usando a mesma sessão: há 1 container Evolution; não achei segundo processo. Mas `docker compose up -d --build` recria o container — o antigo recebe SIGTERM e o novo carrega todas as instâncias; se o antigo demorar a sair, há janela de sobreposição | compose | 🔵 |

### 3.3 Estado informado × estado real

- ✅ `GET /instance/connectionState` devolve a variável em memória `stateConnection`
  (`evo: instance.controller.ts:393-399`), não um teste do socket. O health check do Atendo
  (`health.scheduler.ts:125`) confia nela: socket zumbi fica "conectado".
- ✅ Bug conhecido do Baileys rc.9 (WhiskeySockets/Baileys#2491, aberto): sessão "surda", keep-alive
  OK, nenhum `close`, `messages.upsert` para. Compatível com Drog. Kelly I (17/10). 🟡
- ✅ O `fetch` da `EvolutionProvider.api` **não tem timeout** (`evolution.provider.ts:35`). Uma
  Evolution travada segura envio, health check (serial, `health.scheduler.ts:122-138`) e o
  `InboundProcessor` (mídia, foto) indefinidamente.

### 3.4 Bloqueio de event loop e dependências

- 🟡 Um único processo Node atende ~42 instâncias: criptografia Signal, `ffmpeg`, conversões e
  todas as consultas Prisma. Sob a carga do incidente de 16/10 (consultas de 20–50 s) é
  plausível o keep-alive (30 s) estourar → 408/428 em massa. Sem métrica de *event loop lag*,
  não dá para afirmar.
- ✅ Gravação de `creds` engole erro (`saveKey`… `catch { return null }`,
  `evo: use-multi-file-auth-state-prisma.ts:28-45`); gravação de chave no Redis também
  (`evo: src/cache/rediscache.ts:51-59`). Com pool esgotado (`P2024`, já visto em produção) ou
  Redis recusando escrita, a sessão em memória e a persistida **divergem**; o próximo restart
  sobe com credenciais/chaves velhas. Classe de falha descrita na Issue #2498. 🟡

---

## 4. Problema C — Webhooks: em que etapa o evento some

Cadeia: **Baileys emite** → fila serial da instância (`eventProcessingQueue`) → handler grava no
banco da Evolution → **Evolution publica** (axios, retentativa) → **Atendo recebe** (valida,
enfileira) → **worker processa**.

| Etapa | Falha encontrada | Evidência | Classe |
|---|---|---|---|
| Emissão (Baileys) | mensagem que não decifra é **descartada sem webhook**: `Bad MAC`, `No session record`, `No matching sessions`, `Invalid PreKey ID`… | `evo: …service.ts:1087-1103` (log `Message ignored with messageStubParameters`) | ✅ |
| Emissão | sessão "surda" sem `close` (Baileys#2491) | issue upstream | 🟡 |
| Fila da instância | **serial**: `messages.upsert` e `messages.update` são `await`; um handler lento atrasa **todos** os eventos do número, inclusive `connection.update` | `evo: …service.ts:1875-1925` | ✅ |
| Fila da instância | o webhook de **edição** (`protocolMessage`) é enviado com `await` dentro dessa fila. Com o Atendo fora (deploy, Redis cheio), a retentativa padrão (10×, timeout 60 s, backoff 5→300 s) **bloqueia o número por até ~30 min** | `evo: …service.ts:1133`; `evo: webhook.controller.ts:203-290`; `evo .env.example:295-302` | ✅ mecanismo · 🟡 ocorrência |
| Gravação | `message.create` falhou (pool, deadlock, `P2024`) → `catch` externo engole o erro e **o lote inteiro fica sem webhook** (inclusive as mensagens seguintes do lote) | `evo: …service.ts:1086-1553` (um único `try`) | ✅ |
| Publicação | `MESSAGES_UPSERT` sai sem `await` (paralelo): **ordem não garantida**; respostas 400/401/403/404/422 **não são repetidas** (evento perdido); 413/5xx/timeout repetem até 10× | `evo: …service.ts:1483`; `webhook.controller.ts:218-241` | ✅ |
| Publicação | `apikey` do corpo vem de `this.token` da instância; o Atendo valida com HMAC e responde 401 se não bater → **sem retentativa**. Não achei caminho na 2.3.7 que zere o token no restart, mas a Issue #2694 (2.4.0-rc2, webhook **por instância** apagado no restart) mostra que a área é frágil. Usamos webhook **global** por env, que não depende do banco — **não afetado** | `evo: channel.service.ts:449-459`; `evo: monitor.service.ts:286-292` | 🔵 |
| Recepção | Atendo enfileira **tudo** que não é grupo: os eventos default-ligados do `.env.example` entram na fila com corpo completo, e só depois o parser os ignora | `webhooks.controller.ts:42-55`; `group-filter.ts:27-40`; `evo .env.example:263-287` + `Dockerfile` da Evolution (`COPY .env.example ./.env`) | ✅ |
| Recepção | `removeOnComplete: 1000` / `removeOnFail: 5000` guardam corpos inteiros no Redis `noeviction 512mb` — o mesmo das chaves Signal | `webhooks.controller.ts:54`; compose `redis` | ✅ mecanismo · 🔵 se já encostou no teto |
| Processamento | concorrência 20 sem ordem por número: `connection.update` `close` e `open` podem ser aplicados **fora de ordem**; `numberConnectionChanged` decide com o `number` lido no início (sem trava) → status final errado ou queda 401 não marcada | `inbound.processor.ts:19, 173-176`; `inbound.service.ts:609-641` | ✅ mecanismo · 🔵 frequência |
| Processamento | 5 tentativas com backoff; depois, falha fica em `failed` sem alarme (só Sentry na última) | `whatsapp.module.ts:27` | ✅ |

**Por que o "reiniciar instância" não resolve sempre:** restart não troca chaves (chave corrompida
continua), não limpa o Redis, não desbloqueia a fila serial se o handler preso estiver no banco, e
pode criar sessão duplicada (3.2). Só ler o QR de novo gera chaves novas — e cada re-pareamento é,
ele mesmo, um sinal de risco (seção 5).

---

## 5. Problema A — Banimentos

O que dá para afirmar: **o modelo QR viola os Termos do WhatsApp** e a Meta pode restringir ou
banir qualquer número que o use, sem aviso e sem apelação garantida. Nenhum ajuste técnico zera esse
risco. A Meta não publica os critérios de detecção; as causas abaixo são as que a literatura e os
próprios incidentes do projeto (Drogaria Total, Nova Farma) sugerem.

| Fator | Situação no Atendo | Classe |
|---|---|---|
| **Denúncia/bloqueio por destinatários** (o fator mais citado pela Meta) | contatos frios limitados a 10/dia, automático frio recusado; **mas campanhas QR liberam contato frio** (`allowCold`) até 200/24 h, inclusive para **telefones colados** sem opt-in | ✅ config · 🔵 peso |
| Volume/ritmo de robô | bem coberto (ritmo sorteado, tetos, aquecimento). A fase 1 do aquecimento foi **afrouxada** para perto dos valores que derrubaram números (`number-warmup.ts:27-35`, comentário no próprio código) | ✅ |
| Número novo / chip sem histórico | só checklist declarativo no `QrModal` (não medido) | ✅ |
| **Re-pareamentos frequentes** | cada queda de chave/zumbi termina em QR novo; 401 apaga `creds` | ✅ que acontece · 🔵 que pesa |
| **Loops de reconexão e sessões duplicadas (440)** | mecanismos da seção 3.2 | 🔵 que a Meta pune |
| **Pairing code a cada QR**: o Atendo cria a instância com `number: ctx.phone`; com isso a Evolution chama `requestPairingCode` a cada atualização de QR (até 30) e **ignora `CONFIG_SESSION_PHONE_CLIENT/NAME`** (usa o navegador padrão do Baileys). Depois de um restart do container a instância volta **sem** número e com "Windows/Chrome" → a identificação do cliente muda entre reconexões, e o terceiro campo do navegador é o `release()` do kernel Linux do container | `evolution.provider.ts:78`; `evo: …service.ts:368-371, 583-592`; `evo: monitor.service.ts:300` | ✅ comportamento · 🔵 efeito em ban |
| Consulta "tem WhatsApp" (`onWhatsApp`) | só antes do 1º envio a contato novo — volume baixo | ✅ · 🔵 |
| IP de datacenter, todas as sessões no mesmo IP | sim (sem proxy; doc 04 › Proxy) | 🔵 |
| Conteúdo (farmácia: medicamentos) | política comercial do WhatsApp restringe venda de medicamentos com receita | 🔵 — verificar por caso |

**5 banimentos em uma semana**: para separar causa de correlação é preciso, por número, a linha do
tempo da seção 8.3. Sem ela, qualquer atribuição (inclusive à Evolution) é especulação.

---

## 6. Relatos públicos × nossa versão

| Relato | Estado (18/10/2026) | Afeta a 2.3.7 com nossa config? |
|---|---|---|
| **Issue #2498** — 515 seguido de 401 tratado como logout; instância removida ~7 s após conectar | Aberta. Reportado na 2.2.3; mantenedor pediu reteste na 2.3.7, sem resposta. PR #2509 aberto; commit `1d38d4f` (19/05/2026) no upstream com o mesmo título — não confirmei se está em alguma tag | **Parcial.** O timer de remoção (`DEL_INSTANCE`) está desligado (`evo .env.example:51`), então a remoção automática não ocorre. Mas na 2.3.7 **qualquer 401 apaga as credenciais** (`cleaningUp`, `evo: monitor.service.ts:159-176`). Se o "401 logo após 515" for de fato comportamento normal do multi-dispositivo (afirmação do autor, **não verificada**), viraria falso "removido pelo WhatsApp" + pausa no Atendo. 🔵 — conferir no log: 401 até 30 s depois de `stream:error code=515` |
| **PR #2612** — regressão da 2.4.0-rc2: 408 tratado como fechamento definitivo | Aberto, não mergeado | **Não afeta a 2.3.7** (408 reconecta). ✅ **Confirmado na rc2**: `codesToNotReconnect = [401, 403, 402, 406, 408]` + `logout.instance` → credenciais apagadas (`evo-2.4.0-rc2: whatsapp.baileys.service.ts:498-555`). A rc2 também introduziu reconexão por `setTimeout(3000)` sem trava — temporizadores concorrentes. **Não atualizar para a rc2.** |
| **Issue #2647** — Baileys recebe e `MESSAGES_UPSERT` não sai; instância presa | Aberta, sem resposta de mantenedor. Relatada **na 2.3.7** e na 2.4.0-rc2, Baileys rc.9 | **Sim.** Três mecanismos confirmados no código produzem exatamente esse sintoma: descarte por erro de decifragem, `try` único que engole falha de banco, fila serial travada (seção 4). Mais o Baileys#2491 (sessão surda) |
| **Issue #2694** — config de webhook apagada no restart do container | Fechada como *not planned* (autor abandonou a Evolution). 2.4.0-rc2, webhook por instância, `DATABASE_SAVE_DATA_*=false` | **Não afeta**: usamos webhook global por variável de ambiente e `SAVE_DATA_INSTANCE=true` (default embutido) |

---

## 7. Correções recomendadas (ordem de execução)

### P0 — esta semana (baixo risco, alto impacto)

1. **Desligar os eventos que não usamos** no compose da Evolution (os dois arquivos):
   `WEBHOOK_EVENTS_MESSAGES_SET`, `MESSAGES_DELETE`, `SEND_MESSAGE`, `SEND_MESSAGE_UPDATE`,
   `CONTACTS_SET`, `CHATS_SET/UPSERT/UPDATE/DELETE`, `GROUPS_UPSERT/UPDATE`,
   `GROUP_PARTICIPANTS_UPDATE`, `LABELS_EDIT/ASSOCIATION`, `CALL` = `"false"`. Ligar
   `WEBHOOK_EVENTS_STATUS_INSTANCE` e `LOGOUT_INSTANCE` (forense). Baixar
   `WEBHOOK_REQUEST_TIMEOUT_MS` para ~10000 (o Atendo responde em < 1 s).
2. **Redis próprio para a Evolution** (container `evolution-redis`, AOF, sem `maxmemory`
   compartilhado com BullMQ) **e incluí-lo no backup** — hoje restaurar o backup perde todas as
   chaves Signal. Migração: `redis-cli --rdb`/`MIGRATE` das chaves `evolution:*` com a Evolution
   parada, de madrugada. Até lá: monitorar `INFO memory` e `errorstats`.
3. **Timeout em toda chamada à Evolution** (`AbortSignal.timeout`, ~15 s; 60 s para mídia) em
   `EvolutionProvider.api`, e health check com concorrência limitada em vez de laço serial.
4. **Restart manual pela mesma trava** `claimRestart` (`numbers.controller.ts:268`).
5. **403/402/406 como queda forçada** no parser (`evolution.provider.ts:527`), com a mesma pausa
   do 401 e texto próprio ("conta restrita/banida").
6. **Gravar todo `connection.update`** (estado, `statusReason`, `date_time` da Evolution) numa
   tabela de eventos do número; aplicar só se `date_time` for mais novo que o último aplicado
   (resolve a ordem trocada).
7. **Logs da Evolution**: `LOG_LEVEL=ERROR,WARN,INFO` por 2–4 semanas (INFO tem o
   "CONNECTED TO WHATSAPP") e manter `LOG_BAILEYS=error` (traz `stream errored out` com o código).
   Rotação de log do Docker.

### P1 — 2 a 4 semanas (patches no build, como os atuais)

8. **Patch "uma conexão por vez"** em `createClient`: mutex por instância; antes de criar,
   `removeAllListeners` + `end()` do socket anterior; ignorar `connection.update` vindo de socket
   que não é o `this.client` atual. Isso substitui a espera de 3 s do patch do restart.
9. **Backoff com jitter** na reconexão do `close` (ex.: 2 s → 60 s) e **logar o `statusCode`**
   de todo `close`.
10. Envolver cada mensagem do `messages.upsert` num `try` próprio (falha de banco não derruba o
    lote) e tirar o `await` do webhook de edição da fila serial.
11. **Não mandar `number`** no `/instance/create` (fim do pairing code repetido e navegador
    consistente). ⚠️ Testar antes num número de teste: muda o fluxo de pareamento.
12. Ajustar `connect()`: com `connecting`, devolver o QR existente sem chamar `create`/`connect`;
    para "QR novo de verdade", usar `DELETE /instance/delete` + `create` (o `logout` com `close`
    é recusado na 2.3.7).
13. **Sonda ativa de vida** (contorno do Baileys#2491): se "conectado" e sem nenhum evento de
    entrada há N min em horário de movimento, restart; se repetir, avisar para ler o QR.
14. Fila `wa-inbound` separada para `connection.update` com concorrência 1 (ordem garantida).

### P2 — produto e risco de banimento

15. Campanha QR: exigir opt-in registrado (não só "telefones colados"); considerar só contatos que
    escreveram nos últimos N dias.
16. Reverter a fase 1 do aquecimento para valores mais conservadores enquanto houver banimentos
    acima do aceitável.
17. Medir **event loop lag** e memória da Evolution; com ~100 números, shard (`EvolutionProvider.shard`).

Atualização de versão: **ficar na 2.3.7**. Reavaliar quando houver tag estável (não `-rc`) que
traga Baileys mais novo **e** sem a regressão do 408, testada num número de homologação.

---

## 8. Como validar com os dados de produção

### 8.1 Motivo das quedas

```sql
-- banco da Evolution: última queda definitiva de cada instância (401/403/402/406)
SELECT name, "connectionStatus", "disconnectionReasonCode", "disconnectionAt",
       left("disconnectionObject", 300) AS obj
FROM "Instance" ORDER BY "disconnectionAt" DESC NULLS LAST;
```

```sh
docker logs --since 168h atendo-prod-evolution-1 2>&1 | grep -Eo 'stream errored out|code="?(401|403|408|428|440|500|503|515)"?|conflict|replaced|device_removed|Connection Closed' | sort | uniq -c
# 401 logo depois de 515 (Issue #2498): olhar a vizinhança
docker logs --since 168h --timestamps atendo-prod-evolution-1 2>&1 | grep -E -A3 'code="?515' | grep -E '401|loggedOut|LOGOUT'
```

Leitura: muitos `440/replaced` = sessão duplicada nossa; `408/428` em rajada em vários números ao
mesmo tempo = host/event loop/rede, não Meta; `401/403` isolado num número = ação sobre a conta.

### 8.2 Webhooks e Redis

```sh
docker logs --since 48h atendo-prod-evolution-1 2>&1 | grep -cE 'Todas as tentativas falharam|Erro não recuperável'
docker logs --since 48h atendo-prod-evolution-1 2>&1 | grep -c 'Message ignored with messageStubParameters'
docker logs --since 48h atendo-prod-evolution-1 2>&1 | grep -cE 'P2024|deadlock|OOM command not allowed'
docker exec atendo-prod-redis-1 redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human'
docker exec atendo-prod-redis-1 redis-cli INFO errorstats
docker exec atendo-prod-redis-1 redis-cli -n 6 --scan --pattern 'evolution:*' | head
docker exec atendo-prod-redis-1 redis-cli --bigkeys
```

### 8.3 Linha do tempo de cada banimento (os 5 da semana)

Para cada número: data do chip/registro; `sessionStartedAt` e fase de aquecimento no dia; enviadas
por hora (atendente × automático × campanha) nas 48 h anteriores; contatos frios usados; restarts
(log `reiniciado por` e automáticos); `440`/`408`/`515` nas 48 h anteriores; código final
(401 × 403) e **o que o celular mostrou** ("conta banida" × "restrita" × aparelho removido);
quantos destinatários bloquearam/denunciaram (se o cliente souber). Comparar com números
saudáveis no mesmo período — sem grupo de controle não há causalidade.

---

## 9. Alternativas

| Opção | O que é | Muda o risco de ban? |
|---|---|---|
| **A. Manter 2.3.7 e corrigir** | seção 7 | Não estruturalmente; tira os fatores técnicos nossos |
| **B. Fork próprio da Evolution** | o que já fazemos em pequena escala (patches no build); fork completo só se os patches P1 virarem muitos | Igual a A |
| **C. Integração própria sobre Baileys** | escrever o que a Evolution faz (sessão, mídia, LID, histórico) | Igual — mesmo protocolo, mesma biblioteca, mesma detecção. Herda os bugs do Baileys (#2491) e passa a ser nosso o trabalho de acompanhar o WhatsApp Web |
| **D. Outra não oficial** (WAHA, WPPConnect, soluções sobre *whatsmeow*) | trocar o motor | **Não**: todas emulam o WhatsApp Web multi-dispositivo e pareiam por QR/código. Motores diferentes (whatsmeow em Go, Puppeteer) podem ter estabilidade de conexão melhor ou pior — **não há dado comparável publicado** que permita afirmar |
| **E. Cloud API oficial (Meta)** | `MetaProvider` já existe e está em uso | **Sim**: sai do modelo proibido. Continua sujeito a *quality rating*, limites de mensagens por dia e restrição por denúncia — mas com regras públicas e processo de recurso |
| **F. Híbrido** | Cloud API para automação/campanha/volume; QR só onde o oficial não atende, com aceite de risco | Concentra o risco onde ele é aceito |

### Matriz comparativa

Notas qualitativas (Alta/Média/Baixa) baseadas no código e no histórico de incidentes do projeto;
**não há métrica medida** de disponibilidade para nenhuma opção.

| Critério | A. Manter + corrigir | B. Fork | C. Baileys próprio | D. Outra não oficial | E. Cloud API | F. Híbrido |
|---|---|---|---|---|---|---|
| Estabilidade de conexão | Média (melhora com P0/P1; limitada pelo Baileys rc.9) | Média | Média–baixa no início | Desconhecida | Alta (HTTP + webhook da Meta, sem sessão) | Alta no oficial / Média no QR |
| Risco de bloqueio / conformidade | Alto, fora dos Termos | Alto | Alto | Alto | Baixo, conforme política (opt-in, templates) | Baixo no oficial / Alto no QR |
| Confiabilidade de webhook | Média (com P0/P1) | Média–alta | Depende de nós | Desconhecida | Alta (Meta repete entrega; assinatura HMAC já validada) | Alta / Média |
| Escalabilidade | ~100 MB RAM e 1 socket por número; shard manual | Igual | Igual | Igual | Sem estado do nosso lado | Mista |
| Custo de infra/operação | Médio e crescente (Evolution + banco + Redis + plantão de QR) | Maior (manter fork) | O maior (equipe dedicada) | Médio + licença em algumas | Baixo de infra | Médio |
| Custo por mensagem | R$ 0 | R$ 0 | R$ 0 | R$ 0 (algumas cobram por sessão) | Resposta na janela de 24 h: grátis; templates por mensagem entregue, por categoria e país — **usar a tabela oficial vigente da Meta** (os valores em `prisma/seed.ts:33-35` não foram conferidos e parecem misturar escala USD/BRL) | Só no tráfego migrado |
| Complexidade de implementação | Baixa | Média | Alta | Média (novo adapter) | **Baixa** (adapter pronto; falta onboarding e templates) | Baixa–média |
| Esforço de manutenção | Médio (patches por versão) | Alto | Muito alto | Médio | Baixo | Médio |
| Compatibilidade com o produto atual | Total | Total | Total (depois de reescrever) | Parcial (novo adapter) | Parcial: sem grupos, sem "digitando" do contato, sem agenda do celular, sem mensagens digitadas no celular do cliente (exceto via coexistência — verificar), sem apagar para todos/editar, sem botão Pix fora de template; início de conversa só por template | Total no conjunto |
| Risco/dificuldade de migração | — | Baixo | Alto | Médio | Médio: número precisa ir para uma WABA (sai do app ou usa coexistência — verificar disponibilidade e condições), verificação da empresa, aprovação de templates, coleta de opt-in | Médio, gradual |
| Dependência de terceiros | Evolution (manutenção lenta: issues #2498/#2647 sem resposta) + Baileys | Baileys | Baileys | o fornecedor | Meta (contratual) | Ambos |

---

## 10. Recomendação

1. **Agora:** opção **A** com os P0 e P1 (patches no build = fork mínimo, opção B só se crescer).
   Isso ataca a parte de B/C que é nossa e gera os dados que faltam para A.
2. **Em paralelo:** opção **F (híbrido)**. Migrar primeiro para a Cloud API os números que fazem
   **campanha, automação de boas-vindas e alto volume** — onde o QR mais bane e onde o oficial
   custa pouco (resposta na janela é grátis). Manter QR para quem precisa de grupos ou do número
   pessoal, com o aceite de risco que já existe nas campanhas estendido ao número.
3. **Não fazer:** C (Baileys próprio) e D (outra não oficial) com o objetivo de reduzir banimento.
4. **Critério para rever:** se depois dos P0/P1 e de 30 dias de dados os números QR ainda tiverem
   desconexões frequentes ou banimentos acima do aceitável para o negócio, acelerar a migração
   para o oficial.

---

## 11. Estratégia de migração (Cloud API)

**Desacoplamento: já existe.** `WhatsAppProvider` (`providers/provider.interface.ts`) com
`MetaProvider` e `EvolutionProvider`; UI, banco e filas só conhecem `InboundMessage`/`OutboundMessage`;
`PUT /numbers/:id/provider` troca o adapter sem tocar em conversas (chave = telefone do contato).
O que falta é operacional, não arquitetural:

1. **Por cliente:** verificação da empresa na Meta, WABA, número (fora do app ou via coexistência),
   token de System User, inscrição do app na WABA (`connect` já faz `subscribed_apps`).
2. **Templates:** mapear cada automação que inicia conversa (boas-vindas fora da janela, lembretes
   da Agenda, campanhas, retomadas de fluxo) para um template aprovado; o código já envia template
   onde a janela fecha.
3. **Opt-in:** registrar origem e data do consentimento por contato antes de qualquer template de
   marketing.
4. **Preservação de dados e histórico:**
   - conversas, mensagens, contatos, tags e relatórios ficam no banco do Atendo — nada se perde
     na troca;
   - o **histórico anterior** que hoje vem do banco da Evolution (`fetchHistory`,
     `docs/historico-de-mensagens.md`) deixa de existir no oficial: **antes de desligar a instância,
     importar** para `messages` as conversas ativas (script de backfill a partir de
     `/chat/findMessages`), e manter o dump do `evolution-db` arquivado;
   - mídias recebidas já estão no nosso storage; as que só existem na Evolution precisam do mesmo
     backfill;
   - `phonebook_entries` (agenda) fica como está, sem atualização futura.
5. **Corte gradual:** 1 número piloto → clientes de campanha → demais; QR desligado só depois de
   7 dias sem regressão. Rollback = `PUT /numbers/:id/provider` de volta para `evolution` (exige
   QR novo).
6. **Cobrança:** templates passam a gerar custo no `message_usage` (`BillingCategory`); conferir
   `provider_pricing` contra a tabela oficial antes do piloto.

---

## 12. Erros na documentação existente encontrados nesta auditoria

- `docs/04` › Ciclo do QR: "se está `close`, faz `logout` … para descartar credenciais mortas" —
  na 2.3.7 o `logout` com `close` é recusado; as credenciais não são descartadas (seção 3.2).
- `docs/04` › Sessão zumbi: "as sessões ficam no banco da Evolution" — só `creds`; as chaves
  Signal ficam no Redis e não entram no backup (seção 2).
- `docs/04` › Identificação do aparelho: `CONFIG_SESSION_PHONE_*` não vale para instância criada
  com `number` (todas as nossas) até um restart do container (seção 5).

Corrigir junto com os itens P0/P1 correspondentes (mudam o comportamento descrito).

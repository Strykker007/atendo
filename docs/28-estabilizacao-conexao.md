# 28 — Estabilização da conexão (P0/P1 da auditoria 24)

Etapas independentes, cada uma com seus testes e rollback. Referências: [24](24-auditoria-evolution.md)
(diagnóstico), [26](26-backport-cve-2026-48063.md) (CVE), [27](27-deploy-evolution.md) (deploy isolado).

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Deploy comum não reconstrói nem reinicia a Evolution | ✅ implementada — doc 27 |
| 2 | Gerenciamento de conexões no Atendo (este doc) | ✅ implementada, sem deploy |
| 3 | Reconexão na Evolution (exclusividade, backoff) — e revisão da ordem do 2.5 | ✅ implementada, sem deploy — doc 29 |
| 4 | Webhooks (eventos, timeouts) | pendente |
| 5 | Redis próprio da Evolution (plano) | pendente |

## Etapa 2 — o que mudou (só código do Atendo; Evolution, sessões e banco intocados)

Nenhuma migração de banco: o que precisa de estado fica no Redis, com TTL.

### 2.1 Prazo em toda chamada à Evolution

`EvolutionProvider.api` usa `AbortSignal.timeout`. Antes não havia prazo e valia o do undici
(5 min), segurando envio, health check e worker com a Evolution travada.

| Rota | Prazo |
|---|---|
| padrão | 15 s (`EVOLUTION_TIMEOUT_MS`) |
| `sendMedia`, `sendWhatsAppAudio`, `getBase64FromMediaMessage`, `findContacts`, `fetchAllGroups`, `instance/restart` | 60 s (`EVOLUTION_MEDIA_TIMEOUT_MS`) |
| com `delay` ("digitando…", que a Evolution segura antes de responder) | prazo + `delay` |
| download da foto de perfil na CDN | 60 s |

O prazo vale também para ler o corpo da resposta.

**Como o erro é tratado:**

| Situação | Erro | No envio |
|---|---|---|
| Prazo estourado | `ProviderTimeoutError` (504) | **não repete** — a mensagem pode ter saído; falha com "Evolution não respondeu em N s (…) — a operação pode ter sido feita; confira antes de repetir" |
| Conexão recusada / DNS (Evolution fora do ar) | "Evolution indisponível (ECONNREFUSED)" | repete (a requisição nem chegou) |
| Demais | sem mudança | sem mudança |

**Mudança de comportamento intencional:** antes, a falha do fetch caía como transitória e era
reenviada, o que podia duplicar uma mensagem que já tinha saído.

### 2.2 Restart manual com a trava do automático

`POST /numbers/:id/restart` passa por `NumbersService.claimRestart`, a mesma vaga de 2 min do
restart automático do `OutboundProcessor`. Dentro da janela responde **429** com o texto para o
atendente. Antes, dois cliques, ou um clique junto com o restart automático, eram dois restarts
simultâneos, e com isso dois sockets para a mesma sessão (o WhatsApp derruba um com 440).

### 2.3 Fechamentos 401, 402, 403 e 406

`isDefinitiveClose` / `DEFINITIVE_CLOSE` em `whatsapp/connection-events.ts`.

- São os códigos em que a Evolution 2.3.7 **não reconecta e apaga as credenciais**.
- Antes, só o 401 marcava a queda e abria a pausa de reconexão. 402, 403 (acesso negado: conta
  banida ou restrita) e 406 viravam desconexão comum, e o cliente podia re-parear na hora, logo
  depois de uma restrição.
- Agora os quatro marcam `waRemovedAt` com a mesma pausa (2 h / 24 h). O log diz o código e o
  significado.

Os códigos recuperáveis (408, 428, 440, 500, 515) a 2.3.7 reconecta sozinha e **não envia** ao
Atendo (doc 24 › 3.1). Se chegarem, não marcam queda.

### 2.4 Registro de todo `connection.update`

`ConnectionEventsService.record`, chamado pelo `InboundProcessor` para todo evento de conexão.

- **Log estruturado:** `wa.connection <número>: <estado> <código>`, com os campos `numberId`,
  `statusBefore`, `state`, `statusReason`, `definitive`, `at` (relógio da Evolution), `receivedAt`
  (nosso), `applied` e `skipReason`. Fechamento definitivo sai em `warn`.
- **Redis:** os últimos 200 eventos por número em `wa:conn:log:<numberId>` (30 dias).

```sh
docker exec atendo-prod-redis-1 redis-cli LRANGE wa:conn:log:<numberId> 0 20
```

### 2.5 Evento atrasado não sobrescreve o mais novo

A fila de entrada roda em paralelo (20 jobs) e a Evolution repete webhook falho por ~25 min, então
um `open` velho podia chegar depois de um `close`. **Revisado na etapa 3** (doc 29): a 1ª versão
tinha um atalho que aplicava evento com `date_time` mais de 35 min mais velho ("o relógio voltou"),
e com ele um evento obsoleto podia sobrescrever o estado. Regra atual (`orderDecision`, mais os Lua
`ORDER_SEQ_LUA` e `ORDER_LUA`, que comparam e gravam num passo só):

1. **Correção do health check:** quando o health check corrige o status lendo o estado real, grava
   a hora (`wa:conn:hc:<id>`). Webhook que **chegou** antes disso (`receivedAt`, nosso relógio,
   gravado no controller) é ignorado.
2. **Carimbo da guarda de conexão** (imagem `v2.3.7-atendo.3`+): `atendoBoot` (cresce a cada
   início do processo da Evolution; arquivo no volume + piso no relógio), `atendoSeq` (cresce a cada
   mudança de estado no processo) e `atendoGen` (geração do socket).
   - Ordem total por `(boot, seq)`, sem depender de relógio. Igual = retentativa duplicada,
     ignorada. Menor = atrasado, ignorado.
   - **Boot menor:** só é atrasado nos 40 min depois de o boot atual aparecer
     (`BOOT_SWITCH_WINDOW_MS`), porque as retentativas da Evolution morrem com o processo antigo.
     Depois disso, é o contador que recomeçou (volume perdido): aplica e recomeça (`boot_reset`).
   - Referência em `wa:conn:ord:<id>` = `boot:seq:quando-o-boot-apareceu`.
3. **Sem carimbo** (imagem antiga, durante a transição): `date_time` estrito. Mais velho nunca
   sobrescreve, sem atalho. O `date_time` da 2.3.7 é a hora local com "Z" (conferido no webhook
   real: 13:21 "Z" às 16:21 UTC) e só se compara com outro `date_time` dela.
   - **Reconciliação:** a correção do health check também **zera** esta referência
     (`wa:conn:at:<id>`). Se o relógio da Evolution voltar, os eventos seguintes não ficam presos
     atrás de um horário do futuro por mais de um ciclo (5 min).
4. **Sem carimbo nem `date_time`, ou Redis fora do ar:** aplica, como antes.

**Limite:** sem carimbo, um webhook velho repetido pela Evolution depois do health check, sem
nenhum evento mais novo aplicado, ainda passa. Com o carimbo esse caso some: o `seq` dele é menor
que o do último aplicado.

### 2.6 Sessão "conectada" mas inoperante — sonda

`whatsapp/session-probe.ts`, no health check (a cada 5 min).

- **Quando roda:** só em número Evolution `connected` sem sinal de vida (recebida, entrega,
  leitura) há **30 min ou mais**. Número movimentado não é sondado.
- **O que faz:** consulta a foto de perfil do próprio número pela sessão
  (`/chat/fetchProfilePictureUrl`). É uma IQ comum do WhatsApp Web, sem cache no Baileys e sem
  consulta de "tem WhatsApp" de terceiros.
- **Quando marca:** 2 falhas seguidas (~10 min) geram o log `warn` `wa.zombie <número>: Evolution
  diz conectado, mas a sessão não responde…`. Uma resposta depois disso gera
  `wa.zombie … voltou a responder`. Estado em `wa:probe:<id>` (1 dia).
- **Não reinicia nada**, por pedido explícito: reiniciar só porque não chega mensagem pode
  derrubar loja parada. E restart sem a exclusividade de conexão (etapa 3) arrisca socket
  duplicado.
- **Limite:** a 2.3.7 engole o erro dessa rota e responde `null` na hora quando o socket já está
  **fechado** ("Connection Closed"). Esse caso continua com o restart do envio. A sonda pega o
  zumbi que **trava**: não responde em 15 s.

O health check passou a conferir os números **em paralelo (5 por vez)**. Em série, com a Evolution
travada (15 s por chamada), o ciclo passaria dos 5 min.

### Arquivos

| Arquivo | Mudança |
|---|---|
| `whatsapp/providers/evolution.provider.ts` | prazos, `evolutionFetchError`, `probe()`, códigos definitivos e `at`/`statusReason` no parser |
| `whatsapp/providers/provider-error.ts` | `ProviderTimeoutError` (504, nunca transitório) |
| `whatsapp/providers/provider.interface.ts` | `connection.state/statusReason/at`, `probe?` |
| `whatsapp/connection-events.ts` | **novo** — códigos, ordem (carimbo + date_time, etapa 3), registro |
| `whatsapp/session-probe.ts` | **novo** — sonda e estado |
| `whatsapp/health.scheduler.ts` | paralelo (5), marca correção, roda a sonda |
| `whatsapp/inbound.processor.ts`, `webhooks.controller.ts`, `queues.ts` | `receivedAt` no job; registra e filtra `connection.update` |
| `whatsapp/numbers.controller.ts` | restart manual com `claimRestart` (429) |
| `conversations/inbound.service.ts` | queda definitiva com código no log |
| `test/connection-stability.test.ts` | **novo** — 26 testes |

### Testes (18/10/2026)

- `test/connection-stability.test.ts`: 26 testes.
  - **Prazos:** valores por rota e com `delay`.
  - **Erros:** usam o erro **real** do `fetch` do Node contra um servidor local que nunca responde
    (timeout → ambíguo, não transitório, 504) e contra uma porta fechada (ECONNREFUSED →
    transitório).
  - **Parser:** 401/402/403/406 definitivos; 408/428/440/500/515 não.
  - **Ordem:** atrasado ignorado, empate aplica, relógio que voltou aplica, correção do health
    check.
  - **Lua:** contra Redis real (`REDIS_TEST_URL=redis://… npx vitest run …`; sem a variável, é
    pulado, porque os testes da API não sobem Redis).
  - **Sonda:** marca na 2ª falha, avisa uma vez, desmarca quando responde.
- Suíte inteira da API: **957 testes passando**, mais 1 pulado (o Lua, que roda com Redis).
- `tsc --noEmit` da API: sem erros.
- O ESLint do repositório não roda (configuração no formato antigo, problema anterior a esta
  mudança).

### Riscos

- **Envio que estoura 15 s + delay vira falha sem reenvio.** O atendente vê o aviso para conferir.
  Antes ficava até 5 min pendurado e depois reenviava. Se a Evolution estiver lenta de forma
  geral, mais mensagens podem aparecer como falha (e algumas terem saído): acompanhar
  `Evolution não respondeu` no log.
- **402/403/406 passam a abrir a pausa de reconexão**, que é 409 no "Conectar". É o comportamento
  desejado, mas o cliente pode estranhar. O texto do aviso no painel continua o do 401.
- **A sonda gera uma consulta a mais**, a cada 5 min, só em número quieto há 30 min.

### Rollback

`git revert` do commit da etapa 2, seguido do deploy comum (api/worker): nada a migrar. As chaves
`wa:conn:*` e `wa:probe:*` no Redis expiram sozinhas (≤ 30 dias) e não são lidas pelo código antigo.

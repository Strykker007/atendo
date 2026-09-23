# 14 — Qualidade e observabilidade

Duas redes de proteção para rodar na casa do cliente: **testes** (evitam que um bug chegue lá)
e **observabilidade** (quando chegar, você descobre antes do cliente ligar).

## Testes

Rodar:

```bash
pnpm test                          # tudo (é o que o CI roda)
pnpm --filter @atendo/api test:watch
```

Runner: **Vitest**, em `apps/api/test/`. Os testes são **unitários e offline**: não sobem
Postgres, Redis, fila nem rede. `test/setup.ts` só preenche as variáveis que `config/env.ts`
exige na importação, e `TZ=UTC` fixa o fuso para o resultado ser igual no seu Mac e no CI.

Por que estes arquivos e não outros: são os pontos onde um erro **custa dinheiro, manda
mensagem errada para o cliente final ou marca dois clientes no mesmo horário**.

| Arquivo | O que protege |
|---|---|
| `meta.provider.test.ts` | Leitura do webhook da Meta (texto, botão, lista, mídia, anúncio, status), validação da assinatura HMAC e montagem do envio — inclusive os limites da Meta (≤3 opções viram botões, 4–10 viram lista, título de botão em 20 caracteres) |
| `evolution.provider.test.ts` | Leitura do webhook da Evolution (tipos de mídia, `fromMe`, grupos, acks, `connection.update` com logout 401 e estado transitório), autenticação por token da instância e envio (texto, menu numerado, áudio PTT, mídia em base64, shard) |
| `scheduling-time.test.ts` | Conversão de fuso: virada de dia, dia da semana, horário de verão, fuso do tenant ≠ fuso da máquina |
| `scheduling-slots.test.ts` | Disponibilidade: passo, duração que não cabe, colisão com agendamento, horário no passado, vários intervalos no dia, limite do menu |
| `flow-answer.test.ts` | Como o contato escolhe: id do botão, número, texto exato/parcial — e o que **não** pode ser aceito como escolha |
| `quota.test.ts` | Quota: dentro do incluído, excedente cobrado, limite rígido, assinatura suspensa, fronteira exata |
| `reports-dsl.test.ts` | A DSL de relatórios recusa métrica/agrupamento fora da lista e tentativa de injeção de SQL |

### Como escrever um teste aqui

A lógica testável foi isolada em módulos **puros**, sem Nest nem Prisma — é isso que permite
testar sem subir nada:

- `modules/scheduling/time.ts` — conversões de fuso
- `modules/scheduling/slots.ts` — `computeSlots` (o serviço só busca os dados e delega)
- `modules/flows/answer.ts` — `choose`, `validAnswer`, `interpolate`
- `modules/billing/quota.ts` — `decideCanSend`

Ao criar uma regra de negócio nova que dê para errar, **coloque-a num módulo puro e teste lá**,
em vez de deixá-la no meio de um método que precisa de banco. Para os adapters, o padrão é
gravar um payload real do provider (reduzido ao que o adapter lê) e afirmar sobre o resultado
do `parseWebhook`; para envio, `vi.stubGlobal('fetch', ...)` e afirmar sobre o corpo montado.

O `pnpm typecheck` também cobre `test/` — teste que não compila quebra o CI.

## Observabilidade

Objetivo: **quando algo quebrar na casa do cliente, você descobrir antes dele ligar** — e,
quando ele ligar, conseguir achar exatamente o que aconteceu.

### Log estruturado

`common/observability/app-logger.ts` substitui o logger padrão do Nest nos dois processos
(API e worker). Todo `new Logger(...)` que já existia no código passa por ele sem mudança.

- `LOG_FORMAT=json` (padrão em produção): **uma linha JSON por evento**, pronta para
  Loki/Datadog/CloudWatch — `time`, `level`, `msg`, `context`, `requestId`, `tenantId`,
  `userId`, `job`, `stack` e o que mais for passado como objeto.
- `LOG_FORMAT=pretty` (padrão fora de produção): linha legível e colorida no terminal.
- `LOG_LEVEL` = `debug` | `log` | `warn` | `error`.
- `error`/`warn` saem em **stderr**, o resto em **stdout** (o Docker separa os dois).

### requestId: o fio que liga tudo

`RequestContextMiddleware` abre um `AsyncLocalStorage` por requisição:

- aceita o `x-request-id` de quem chamou (proxy, outro serviço) ou gera um;
- **devolve no cabeçalho `x-request-id`** e **no corpo de toda resposta de erro**;
- todo log daquela requisição sai com o mesmo `requestId` — sem precisar passá-lo adiante.

Na prática: o cliente manda o print do erro, você procura o `requestId` no log e vê a
requisição inteira, com tenant, usuário e a exceção.

Depois dos guards, `HttpLoggingInterceptor` completa o contexto com `tenantId`/`userId` e
escreve uma linha por requisição atendida com método, rota, status e duração. `/health`
(chamado pelo Docker a cada 15s) fica em `debug` para não poluir.

### Erros

`AllExceptionsFilter` é o último filtro: nenhum erro sai sem log.

- **4xx** (validação, permissão) → `warn`; são esperados.
- **5xx** → `error` com stack e envio ao Sentry.
- A resposta preserva o formato do Nest e acrescenta `requestId`.

`uncaughtException` e `unhandledRejection` registram, avisam o Sentry, aguardam o envio e
**encerram o processo** — deixar de pé um processo em estado desconhecido é pior do que
o Docker reiniciar.

### Filas

`TrackedWorkerHost` é a base de todos os processors (entrada, saída, fluxos, lembretes,
cobrança, saúde dos números). Quem herda implementa `handle` no lugar de `process`. Ele:

- abre um contexto por job (`job.queue`, `job.name`, `job.id`) — o log do job sai
  identificado, e processors enriquecem com `tenantId` assim que o descobrem;
- mede a duração;
- **loga toda falha** com a tentativa atual e se ainda haverá retry — sem isto o BullMQ
  engole o erro e um envio que falhou simplesmente some;
- reporta ao Sentry **só na última tentativa**: erro transitório que o retry resolveu não é incidente.

### Sentry

Opcional e desligado por padrão: sem `SENTRY_DSN` nada é enviado e o projeto roda igual.
Com DSN, cada erro vai com `requestId`, `tenantId`, usuário e o job de origem.
`sendDefaultPii: false` — corpo e cabeçalhos **não** são enviados, porque passam token de
provider e dados do contato.

Variáveis: `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` (0 a 1, deixe 0 até precisar),
`APP_VERSION` (agrupa erros por release).

### Saúde

`GET /health` já verifica Postgres e Redis e é o healthcheck do Docker (a cada 15s).

### O que ainda falta

- Métricas (profundidade das filas, taxa de falha de envio por número) num endpoint
  Prometheus — hoje isso só aparece no log.
- Alerta ativo (e-mail/WhatsApp para você) quando uma fila acumula ou um número cai.

# 03 — Arquitetura

## Decisão: monólito modular em TypeScript

Um único código-base, uma linguagem, módulos NestJS bem separados. Motivos:

- Troca de provider e checagem de quota precisam de **transação e leitura consistente** entre módulos. Em microserviços isso viraria saga.
- Uma pessoa/time pequeno entrega front e back sem trocar de contexto.
- Módulos conversam por interface; extrair `whatsapp` ou `reports` para um serviço próprio no futuro é mecânico.

## Monorepo

```
atendo/
├── apps/
│   ├── api/                 NestJS 11 + Prisma  (porta 4000)
│   │   ├── prisma/          schema.prisma, migrations, seed.ts
│   │   └── src/
│   │       ├── main.ts      bootstrap HTTP (helmet, CORS, validação)
│   │       ├── worker.ts    bootstrap só das filas (produção)
│   │       ├── config/env.ts   valida .env com zod — falha cedo
│   │       ├── common/      PrismaService, CryptoService (AES-GCM), RedisService
│   │       └── modules/
│   │           ├── auth/           login, refresh rotativo, guards JWT e de role
│   │           ├── tenants/        clientes (super_admin) e atendentes (tenant_admin)
│   │           ├── whatsapp/       providers/, números, webhooks, filas in/out
│   │           ├── conversations/  ingestão, envio, status, tags, WebSocket
│   │           ├── billing/        preços, ledger, quota, alertas, reconciliação
│   │           ├── tags/
│   │           ├── quick-replies/
│   │           └── reports/        DSL → SQL parametrizado
│   └── web/                 Next.js 15 App Router (porta 3000)
│       └── src/
│           ├── app/(app)/   rotas autenticadas (conversas, numeros, …)
│           ├── components/  layout/, chat/, numbers/, ui/
│           └── lib/         api.ts (fetch + refresh), hooks.ts (react-query), store.ts (zustand)
├── packages/shared/         enums e tipos canônicos usados pelos dois lados
├── infra/docker-compose.yml Postgres, Redis, Evolution
└── docs/
```

`packages/shared` é compilado para `dist/` e a API importa de lá. **Depois de editar `packages/shared`, rode `pnpm --filter @atendo/shared build`.** O Next usa `transpilePackages`, então lê direto do fonte.

## Fluxo de uma mensagem recebida

```
Contato ──WhatsApp──▶ Provider (Meta ou Evolution)
                          │  HTTP POST
                          ▼
             POST /webhooks/{meta|evolution}          (WebhooksController)
                 1. verifyWebhook(headers, rawBody)    assinatura HMAC / token
                 2. inbound.add(job)                   fila BullMQ "wa-inbound"
                 3. responde 200 em < 50 ms
                          │
                          ▼  (worker)
                   InboundProcessor
                 1. provider.parseWebhook(body) → InboundMessage[] (formato canônico)
                 2. NumbersService.findByExternal(provider, externalNumberId)
                 3. ConversationsService.ingestInbound(number, msg)
                      ├─ idempotência: Message.externalId único
                      ├─ upsert Contact
                      ├─ Conversation aberta ou nova (status waiting)
                      ├─ cria Message (direction in)
                      ├─ UsageService.record(...)     ← ledger de cobrança
                      └─ gateway.emit('message' | 'conversation')  → painel atualiza
                 4. reações (`ParsedWebhook.reactions`) → InboundService.applyReaction
                      └─ atualiza `reactions` da mensagem reagida e emite 'message' (sem criar mensagem nem cobrar)
```

Por que fila? A Meta exige resposta rápida e reenvia se demorar; a Evolution também tem retry. Enfileirar garante que nunca perdemos evento e que picos não derrubam a API.

## Fluxo de uma mensagem enviada

```
Painel ──POST /conversations/:id/messages──▶ ConversationsService.send
    1. conversa existe e não está encerrada
       número = o da conversa (do banco, nunca do payload), ativo, do mesmo tenant  (senão 422)
       expectedNumberId diferente do número da conversa                           (senão 409)
       número conectado                                                          (senão 422)
    2. se provider = meta e sem template: dentro da janela de 24h?  (senão 400)
    3. UsageService.canSend(tenant, 'messages' | 'templates')       (senão 403)
    4. idempotencyKey já usada na conversa → devolve a mesma mensagem
    5. cria Message status=pending (queueSeq), conversa vira in_progress e é atribuída
    6. enqueueOutbound()   fila "wa-outbound"
    7. emite 'message' (o painel mostra com relógio de pendente)
                          │
                          ▼  (worker; retry só em erro transitório)
                   OutboundProcessor
    1. vez na conversa (só a pendente mais antiga sai), número conectado (senão pausa), prazo
    2. teto do dia + reserva de ritmo (número e conversa)
    3. provider.send(ctx, OutboundMessage) → externalId + billingCategory
    4. Message status=sent, externalId
    5. UsageService.record(...)
    6. emite 'message' e promove a próxima da conversa
    (falha definitiva → status=failed + erro visível na bolha + "Tentar novamente")
```

Detalhes da fila (ordem, limites, reconexão, retry, valores padrão): [Envio](envio.md).

Status posteriores (delivered/read) chegam por webhook e `applyStatus` só avança, nunca regride.

**Garantia de entrega única.** Depois que `provider.send()` retorna, a mensagem *já está no celular do contato*. Por isso o processor grava o `externalId` imediatamente e trata contabilidade (ledger/uso) como best-effort — um erro ali é logado, nunca vira `failed` nem retry. E um job que encontra mensagem `pending` **com `externalId`** não reenvia: só corrige o status. `UsageService.record` é idempotente por `messageId`. (Esse bug aconteceu de verdade: o ledger falhou por chave duplicada num reenvio, o retry reenviou e o contato recebeu em dobro.)

## Posse do atendimento

`Conversation.assigneeId` é a posse. Regras em `ConversationsService`:

- **`claim()` é atômico**: `updateMany` com `where: { assigneeId: null OR = eu }`. Se `count === 0`, alguém ganhou antes → `409 Conflict` com o nome de quem assumiu. Não há janela entre "ler" e "gravar".
- **Responder = assumir** com a mesma condição atômica (`send()`), então nem precisa clicar em *Assumir*. Admin responde conversa alheia sem tomar a posse.
- **`list()`/`counts()` recebem o viewer**: atendente comum em `in_progress` vê só as suas; admin vê todas ou filtra por `assigneeId`. `waiting` e `closed` são de todos.
- `transfer()` (dono ou admin) e `release()` (volta a `waiting`, sem dono). Encerrar mantém o dono no histórico; reabrir em `in_progress` = quem reabriu assume.
- Toda mudança de posse emite `conversation` no socket → as listas das outras atendentes atualizam e a conversa some/aparece na hora.

## Tempo real

`ConversationsGateway` (Socket.IO). O cliente conecta com `auth.token` = access token; o gateway valida o JWT e coloca o socket na sala `tenant:<id>`. Eventos:

| Evento | Payload | Quando |
|---|---|---|
| `message` | Message | criada ou mudou de status |
| `conversation` | Conversation | criada, status, atribuição, tags |
| `number` | `{id, status, qrCode?}` | QR novo, conectou, caiu |
| `appointment` | `{id}` | agendamento criado/alterado |
| `kanban` | `{}` | colunas do Kanban mudaram (ordem, tag virou/deixou de ser etapa, criada, excluída) |
| `typing` | `TypingEvent` `{conversationId, state}` | contato digitando (`composing`), gravando (`recording`) ou parou (`paused`). Efêmero, só Evolution |

Mover card no Kanban é trocar a tag principal e sai como `conversation`, como qualquer outra mudança no atendimento.

No front, `useRealtime()` aplica os eventos direto no cache do react-query.

Quem emite nem sempre é a API: os processors de fila (inbound, outbound, fluxos, agenda, health) rodam também no worker, que não tem servidor Socket.IO. Nesse caso o gateway publica direto no Redis via `@socket.io/redis-emitter` e o `RedisIoAdapter` da API entrega aos sockets da sala. Nunca emita por `gateway.server` direto — use os métodos `emit*` do gateway, senão o evento some em silêncio quando o job cai no worker.

## Processos

- **API** (`main.ts`): HTTP + WebSocket. Também registra os processors (o `WhatsAppModule` entra nos dois módulos), então com API e worker de pé o BullMQ divide os jobs entre eles.
- **Worker** (`worker.ts`): só filas. Em produção rode separado (`pnpm --filter @atendo/api worker`) para escalar independentemente e para que envio pesado não afete latência da API.

## Segurança — decisões

| Preocupação | Como tratamos |
|---|---|
| Isolamento entre clientes | Todo `where` inclui `tenantId` vindo do JWT (`@CurrentUser()`), nunca do body. O dono do sistema (`super_admin`, sem tenant) só acessa rotas marcadas `@NoTenantOk()` — `TenantGuard` devolve 403 nas demais. Para operar dentro de um cliente ele usa **impersonação**: `POST /tenants/:id/impersonate` emite um access token (1 h) com `tenantId` do cliente, papel `tenant_admin` e `impersonatorId`; o refresh cookie continua sendo o do dono e o front re-impersona ao renovar (`sessionStorage`, por aba) |
| Senhas | argon2id; verificação em hash fake quando e-mail não existe (evita enumeração por timing) |
| Sessão | Access token JWT 15 min no header; refresh 30 d em cookie httpOnly/sameSite, **rotacionado a cada uso** e revogável |
| Credenciais de provider | AES-256-GCM (`CryptoService`) com chave fora do banco (`ENCRYPTION_KEY`) |
| Webhooks | Meta: HMAC SHA-256 do corpo bruto com `META_APP_SECRET`. Evolution: token por instância derivado por HMAC da chave global |
| Injeção | Prisma sempre; relatórios usam `Prisma.sql` com placeholders, dimensões/métricas de lista fechada |
| Brute force | `@nestjs/throttler` global (120/min) e 10/min no login |
| Headers | helmet, com `Cross-Origin-Resource-Policy: cross-origin` (senão o navegador bloqueia `<img>` do storage servido pela API em outra origem) |
| Input | `ValidationPipe` com `whitelist` + `forbidNonWhitelisted` — campo desconhecido = 400 |

## Storage de mídia

`StorageService` (`common/storage/`) com dois drivers escolhidos por `STORAGE_DRIVER`:

| Driver | Quando | Config |
|---|---|---|
| `local` | Dev e enquanto não há produção — **grátis** | `STORAGE_LOCAL_DIR` (padrão `apps/api/storage`, ignorado pelo git) |
| `s3` | Produção — Cloudflare R2, AWS S3, MinIO, qualquer S3-compatível | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |

Trocar de driver é só variável de ambiente; o código não muda.

Regras:
- O storage é **privado**. `Message.mediaUrl` guarda a **chave** (`media/<tenant>/<aaaa-mm>/<uuid>.<ext>`), não uma URL.
- Ao sair para o navegador (HTTP ou socket), `ConversationsService.present()` troca a chave por uma **URL assinada** (`GET /media/*?exp&sig`, HMAC com `ENCRYPTION_KEY`, válida 1 h). `<img>`/`<audio>` não mandam header, por isso a autorização vai na query.
- Upload do atendente: `POST /uploads` (multipart, campo `file`, até `MEDIA_MAX_MB`, tipos permitidos: imagem, áudio, vídeo mp4, pdf, office). Devolve a chave; o envio referencia `mediaKey`, que precisa começar com `media/<tenant do usuário>/` (checado no controller).
- Providers recebem o binário (`MediaPayload`) — nunca a URL. Detalhes em [04](04-providers-whatsapp.md#mídia).

## O que ainda não está aqui (ver roadmap)

2FA (campo existe, fluxo não), gateway de pagamento, e-mail de alerta, testes automatizados.

## Divisão dos arquivos grandes

Dois arquivos passaram do ponto e foram quebrados **por caminho do dado**, não por tipo de arquivo:

- `conversations.service.ts` (816 linhas) perdeu tudo que **entra pelo provider** para `inbound.service.ts`: mensagem recebida, mensagem digitada no celular, confirmação de entrega e mudança de conexão. Ficou 579 + 273. `InboundService` depende de `ConversationsService`, nunca o contrário — quem recebe precisa reabrir conversa; quem atende nunca precisa saber de webhook.
- `hooks.ts` (584 linhas, importado por toda tela) virou `lib/hooks/` com um arquivo por domínio e um **barril** em `hooks.ts` que reexporta tudo. Nenhuma tela mudou de import: a organização é interna, não um recado para quem consome. Maior arquivo agora: 324 linhas (`core`, com tipos e conversas).

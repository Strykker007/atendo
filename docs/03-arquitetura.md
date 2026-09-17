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
```

Por que fila? A Meta exige resposta rápida e reenvia se demorar; a Evolution também tem retry. Enfileirar garante que nunca perdemos evento e que picos não derrubam a API.

## Fluxo de uma mensagem enviada

```
Painel ──POST /conversations/:id/messages──▶ ConversationsService.send
    1. conversa existe e não está encerrada
    2. se provider = meta e sem template: dentro da janela de 24h?  (senão 400)
    3. UsageService.canSend(tenant, 'messages' | 'templates')       (senão 403)
    4. cria Message status=pending, conversa vira in_progress e é atribuída
    5. outbound.add({ messageId })   fila "wa-outbound"
    6. emite 'message' (o painel mostra com relógio de pendente)
                          │
                          ▼  (worker, 3 tentativas com backoff)
                   OutboundProcessor
    1. carrega Message + número + provider
    2. provider.send(ctx, OutboundMessage) → externalId + billingCategory
    3. Message status=sent, externalId
    4. UsageService.record(...)
    5. emite 'message'
    (falha definitiva → status=failed + erro visível na bolha)
```

Status posteriores (delivered/read) chegam por webhook e `applyStatus` só avança, nunca regride.

## Tempo real

`ConversationsGateway` (Socket.IO). O cliente conecta com `auth.token` = access token; o gateway valida o JWT e coloca o socket na sala `tenant:<id>`. Eventos:

| Evento | Payload | Quando |
|---|---|---|
| `message` | Message | criada ou mudou de status |
| `conversation` | Conversation | criada, status, atribuição, tags |
| `number` | `{id, status, qrCode?}` | QR novo, conectou, caiu |

No front, `useRealtime()` aplica os eventos direto no cache do react-query.

## Processos

- **API** (`main.ts`): HTTP + WebSocket. Em dev também roda os processors (mesmo processo).
- **Worker** (`worker.ts`): só filas. Em produção rode separado (`pnpm --filter @atendo/api worker`) para escalar independentemente e para que envio pesado não afete latência da API.

## Segurança — decisões

| Preocupação | Como tratamos |
|---|---|
| Isolamento entre clientes | Todo `where` inclui `tenantId` vindo do JWT (`@CurrentUser()`), nunca do body |
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

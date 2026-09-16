# Atendo

Plataforma SaaS de atendimento via WhatsApp: múltiplos clientes (tenants), múltiplos números por cliente, fila de conversas com status e tags, respostas rápidas, planos com limite de uso e relatórios dinâmicos.

## Stack

| Camada | Tecnologia |
|---|---|
| API | NestJS 11 (TypeScript), Prisma, PostgreSQL 16, Redis 7, BullMQ, Socket.IO |
| Web | Next.js 15 (App Router), React 19, Tailwind, TanStack Query, Zustand |
| WhatsApp | `WhatsAppProvider` com dois adapters: **Meta Cloud API** (oficial) e **Evolution API** (não-oficial, QR code) |
| Monorepo | pnpm workspaces + Turborepo |

```
apps/api        NestJS — módulos: auth, tenants, whatsapp, conversations, tags, quick-replies, billing, reports
apps/web        Next.js — painel de atendimento
packages/shared enums e tipos canônicos compartilhados (InboundMessage, OutboundMessage, PlanLimits…)
infra/          docker-compose (Postgres, Redis, Evolution API)
```

## Rodando local

Pré-requisitos: Node 22+, Docker.

```bash
corepack enable && corepack prepare pnpm@latest --activate
pnpm install
cp .env.example .env            # já existe um .env gerado; ajuste se quiser
# ENCRYPTION_KEY: openssl rand -base64 32
pnpm infra:up                   # Postgres :5432, Redis :6379, Evolution :8080
pnpm db:migrate                 # cria as tabelas (prisma migrate dev)
pnpm db:seed                    # planos, preços Meta BR, super admin e tenant demo
pnpm dev                        # api :3001 + web :3000
```

Logins do seed: `admin@atendo.local / admin12345` (super admin) e `demo@atendo.local / demo12345` (admin do tenant demo).

Worker de filas (envio, webhooks, reconciliação) roda em processo separado em produção: `pnpm --filter @atendo/api build && pnpm --filter @atendo/api worker`. Em dev, `nest start --watch` já registra os processors no mesmo processo.

## Conceitos-chave

**Troca de provider** — `PUT /numbers/:id/provider { provider: 'meta' | 'evolution', config }`. Só troca o campo `provider` do número e reconecta; conversas e histórico não são tocados. Mensagens de todos os providers são normalizadas para `InboundMessage`/`OutboundMessage`.

**Custo e cobrança** — cada mensagem gera uma linha em `message_usage` (ledger append-only) com `billingCategory` e `providerCost` (tabela `provider_pricing`). Redis guarda contadores do mês para o `QuotaGuard`; o job diário `reconcile` recalcula `usage_counters` a partir do ledger. Planos têm `limits` (jsonb, ver `PlanLimits`): `hardLimit` bloqueia ao estourar, senão cobra excedente. Alertas em 80% e 100%.

**Janela de 24h (Meta)** — fora dela só sai template aprovado; a API recusa com erro claro.

## Webhooks

- Meta: `GET/POST /webhooks/meta` (verify token em `META_WEBHOOK_VERIFY_TOKEN`, assinatura HMAC com `META_APP_SECRET`)
- Evolution: `POST /webhooks/evolution` (header `apikey`)

Ambos só validam e enfileiram (`wa-inbound`); o processamento é no worker.

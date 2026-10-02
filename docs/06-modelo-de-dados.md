# 06 — Modelo de dados

Fonte: `apps/api/prisma/schema.prisma`. Todas as tabelas de dados de cliente têm `tenantId` e `onDelete: Cascade` a partir do tenant.

```
tenants ─┬─ users ─── refresh_tokens
         ├─ whatsapp_numbers ─┐
         ├─ contacts ─────────┼─ conversations ─┬─ messages ─── message_usage
         │                    │                 └─ conversation_events
         ├─ tags ─────────────┘   (conversation_tags)
         ├─ quick_reply_folders ── quick_replies
         ├─ subscriptions ── plans
         ├─ usage_counters, usage_alerts, invoices
         └─ saved_reports

provider_pricing (global, sem tenant)
```

## Tabelas e por que existem

### Tenancy

**tenants** — o cliente. `slug` único para URLs/identificação. `stripeCustomerId` criado no primeiro checkout.

**users** — `tenantId` null só para `super_admin`. `passwordHash` argon2id. `totpSecret` reservado para 2FA.

**refresh_tokens** — só o hash SHA-256 do token; `revokedAt` permite logout e rotação. Guardamos `userAgent`/`ip` para auditoria.

### WhatsApp

**whatsapp_numbers** — um canal. Campos-chave:
- `provider` (`meta | evolution`) — a troca é aqui.
- `externalId` — `phone_number_id` (Meta) ou `instanceName` (Evolution). Único por provider: é como o webhook acha o número.
- `providerConfig` — credenciais criptografadas (string, não json, de propósito).
- `status` — `connected | pending_qr | disconnected | error`.
- `infraCostMonth` — rateio para margem (Evolution).

**contacts** — telefone E.164 único por tenant. Nome vem do `pushName`/profile do WhatsApp.

**conversations** — um atendimento. `origin` (`organic | ad | post | link`) e `originData` (referral do anúncio) — ver [04 › Origem do lead](04-providers-whatsapp.md#origem-do-lead-atribuição-de-anúncio). Único aberto por (número, contato); encerrar e receber de novo cria outra linha. `lastInboundAt` define a janela de 24h da Meta. `unreadCount` para o badge. Índice em `(tenantId, status, lastMessageAt desc)` = a query da lista.

**conversation_events** — histórico do atendimento (auditoria). A conversa guarda só a foto do momento: dono atual, data do fechamento, último resultado. Isso não responde "quantos atendimentos a Ana fechou em março", e reabrir **limpa** o desfecho da conversa, então o resultado anterior deixava de existir.

Cada linha é um fato: `claimed`, `transferred`, `released`, `closed`, `reopened`, com `actorId` (nulo = automação), `targetId` (transferência), status de/para e o desfecho **copiado** — congelado ali, para que reabrir não mude o número de um mês já fechado. Linha gravada nunca é alterada nem apagada.

Cada `closed` é **um atendimento**: a mesma pessoa volta semanas depois, na mesma conversa, e aquilo é outro atendimento, com outro dono e outro resultado. Índices por `(tenantId, type, createdAt)` e `(tenantId, actorId, createdAt)` = a base do relatório por atendente e período. Começa a valer da estreia em diante; o que aconteceu antes não foi gravado.

**messages** — `externalId` único → idempotência de webhook. `raw` guarda o payload original (debug e reprocessamento). `authorId` = atendente que enviou.

**tags** / **conversation_tags** — N:N. Índice em `tagId` para o filtro por tag.

**quick_reply_folders** / **quick_replies** — painel direito. `position` para ordenação manual.

### Cobrança

**plans** — `limits` jsonb (`PlanLimits`). `billingModel` informativo (`fixed | usage | hybrid`). `stripePriceId` (`price_…`) criado por `pnpm stripe:sync`.

**subscriptions** — 1:1 com tenant. `status`: `trialing | active | past_due | suspended | canceled`. `externalId` = `sub_…` do Stripe; `cancelAtPeriodEnd`; `graceUntil`.

**provider_pricing** — histórico de preços por `(provider, country, category)`; sempre inserir, nunca editar.

**message_usage** — ledger, uma linha por mensagem. Ver [05](05-planos-e-cobranca.md).

**ai_usage** — ledger de IA, uma linha por chamada ao modelo (`kind`, modelo, tokens de
entrada e saída, custo em USD e BRL calculado na hora, latência, e `error` quando falhou).
É o que permite saber a margem da IA e aplicar o teto de gasto. Ver [15](15-ia.md).

**usage_counters** — agregado mensal reconciliado (`tenantId + period` únicos).

**usage_alerts** — quais alertas já disparamos (única por tenant/período/métrica/threshold).

**invoices** — espelho da fatura do Stripe: base + excedente, `externalId` (`in_…`), `hostedUrl`. Única por tenant/período.

### Relatórios

**saved_reports** — `definition` jsonb com o `ReportDefinition` (métrica, agrupamento, filtros, tipo de gráfico).

## Enums

| Enum | Valores |
|---|---|
| Role | super_admin, tenant_admin, agent |
| WhatsAppProvider | meta, evolution |
| NumberStatus | connected, pending_qr, disconnected, error |
| ConversationStatus | waiting, in_progress, closed |
| MessageDirection | in, out |
| MessageType | text, image, audio, video, document, sticker, location, contact, template, unknown |
| MessageStatus | pending, sent, delivered, read, failed |
| BillingCategory | service, utility, marketing, authentication, unofficial |
| SubscriptionStatus | trialing, active, past_due, suspended, canceled |
| InvoiceStatus | draft, open, paid, failed, void |

Os mesmos enums existem em `packages/shared/src/enums.ts` para o front. Ao mudar um, mude nos dois.

## Mudando o schema

```bash
# edite apps/api/prisma/schema.prisma
pnpm db:migrate        # cria migration + aplica + regenera client
```

Em produção: `pnpm --filter @atendo/api prisma migrate deploy`.


## Configurações do cliente

**tenant_settings** — fuso horário do cliente (usado pela agenda, pelos fluxos e pelos
relatórios), chave `attendanceActive` (feriado/férias: fecha tudo sem mexer nos horários) e
texto de fora do expediente.

**business_hours** — uma linha por intervalo de atendimento (`weekday` 0 = domingo, `start`
e `end` em "HH:MM" no fuso do cliente). Vários intervalos no mesmo dia cobrem o almoço.
Dia sem linha = fechado; nenhum intervalo cadastrado = sempre aberto.


**contacts** ganhou a ficha preenchida pelo atendente: `email`, `address`, `note1` e
`note2`. Campo enviado vazio vira `null` — o atendente apaga o que não vale mais.

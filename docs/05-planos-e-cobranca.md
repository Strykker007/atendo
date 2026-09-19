# 05 — Planos, uso e cobrança

## Objetivo

Duas coisas ao mesmo tempo: **não ter prejuízo** (custo da Meta e infra cobertos) e **não perder cliente** (avisar antes de bloquear, dar caminho de upgrade).

## Onde o custo realmente está

| Origem | Custo | Observação |
|---|---|---|
| Meta — resposta livre (janela 24h) | R$ 0 | É o caso típico de atendimento |
| Meta — template | Cobrado por mensagem entregue | Marketing é o mais caro; utility/auth baratos |
| Evolution | R$ 0 por mensagem | Custo é o servidor (rateado em `WhatsAppNumber.infraCostMonth`) |

Conclusão: para um SaaS de **atendimento** o limite de mensagens serve mais para criar tiers e proteger infra; o custo variável real é template. Por isso templates têm cota **separada** e nunca devem ser ilimitados em plano fixo.

## Planos

Tabela `plans`. `limits` é jsonb com o formato `PlanLimits` (`packages/shared/src/plans.ts`):

```ts
{
  maxNumbers: 3,                  // números de WhatsApp
  maxAgents: 6,                   // atendentes
  includedMessagesMonth: 10000,   // mensagens ENVIADAS incluídas
  includedTemplatesMonth: 500,    // templates incluídos
  overagePricePerMessage: 0.02,   // null = não permite excedente
  overagePricePerTemplate: 0.6,
  hardLimit: false,               // true = bloqueia ao estourar; false = cobra excedente
  graceDays: 7,                   // tolerância após falha de pagamento
  features: ['flows', 'scheduling'] // funcionalidades plugáveis (docs/10 e 13); ausente = nenhuma
}
```

Seed cria três: Starter (fixo, `hardLimit: true`), Pro e Business (híbridos com excedente). Planos novos são linhas no banco — sem migration.

## Preços do provider

Tabela `provider_pricing` — `(provider, country, category, unitPrice, validFrom)`. `PricingService.unitCost` pega a linha mais recente com `validFrom <= agora`. Quando a Meta reajustar, **insira** uma linha nova (não edite a antiga: o histórico do ledger continua correto).

## Ledger — fonte da verdade

Cada mensagem (entrada e saída) grava uma linha em `message_usage`:

```
tenantId, numberId, messageId, provider, direction, billingCategory, providerCost, occurredAt
```

É append-only. Tudo abaixo deriva dele.

## Contadores rápidos (Redis)

`usage:<tenant>:<YYYY-MM>:messages|messagesIn|templates`. Incrementados no `record()`. São o que o `QuotaGuard` lê antes de cada envio — sem tocar no Postgres a cada mensagem.

`UsageService.reconcile()` (job diário 03:00 UTC via BullMQ scheduler) recalcula a partir do ledger e grava em `usage_counters` + Redis. Se o Redis for zerado, a reconciliação corrige.

## Quota antes de enviar

`UsageService.canSend(tenantId, 'messages' | 'templates')`:

```
sem assinatura          → bloqueia
suspended / canceled    → bloqueia
usado < incluído        → ok
hardLimit = false e overagePrice ≠ null → ok (vai cobrar excedente)
senão                   → bloqueia com mensagem "Limite do plano atingido (N/mês)"
```

O front mostra um banner no lugar do campo de digitação quando estourou (`ChatPane`).

Limites de **quantidade** (números, atendentes) usam `PlanLimitGuard` + `@RequireLimit('maxNumbers')` nos endpoints de criação.

## Alertas

Ao passar de **80%** e **100%** de mensagens ou templates, `usage_alerts` registra (chave única por tenant/período/métrica/threshold — nunca dispara duas vezes). Hoje só loga; enviar e-mail e mostrar banner no painel está no roadmap. `GET /billing/usage` já devolve `used` e `limits` para o front calcular a porcentagem.

## Cobrança com Stripe

**Modelo:** cada `Plan` = um Price mensal recorrente no Stripe. O tenant vira um Customer no primeiro checkout. A assinatura do Stripe é a fonte da verdade; a tabela `subscriptions` é um espelho mantido pelos webhooks. Código: `apps/api/src/modules/billing/stripe.service.ts`.

### Configurar (uma vez)

1. Crie a conta em stripe.com e fique em **modo teste** (toggle no dashboard).
2. Copie a chave secreta (`sk_test_…`) para `STRIPE_SECRET_KEY` no `.env`.
3. Sincronize os planos → cria Product + Price para cada plano sem `stripePriceId`:
   ```bash
   pnpm stripe:sync
   ```
   (ou `POST /billing/sync-plans` como super_admin). Mudou o preço de um plano? Crie um Price novo no Stripe e atualize `plans.stripePriceId` — Prices são imutáveis.
4. Webhook local, com a CLI do Stripe:
   ```bash
   stripe listen --forward-to localhost:4000/webhooks/stripe
   ```
   Copie o `whsec_…` impresso para `STRIPE_WEBHOOK_SECRET`. Em produção, cadastre `https://<api>/webhooks/stripe` no dashboard com os eventos: `checkout.session.completed`, `customer.subscription.*`, `invoice.created`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`.
5. Cartão de teste: `4242 4242 4242 4242`, qualquer data futura e CVC. Para simular falha: `4000 0000 0000 0341`.

Sem `STRIPE_SECRET_KEY` o sistema funciona normalmente, só sem autoatendimento: `GET /billing/usage` devolve `billingEnabled: false` e a tela mostra "fale com o suporte".

### Fluxos

| Ação do cliente (admin do tenant) | O que acontece |
|---|---|
| *Plano e uso → Assinar* | `POST /billing/checkout {planId}` → Checkout Session (assinatura) → redireciona ao Stripe → volta em `/plano?success=1`. Webhook `checkout.session.completed` espelha a assinatura. |
| *Mudar para este* (já assinante) | Troca o Price na assinatura existente com **proration** (diferença cobrada/creditada na próxima fatura). Sem novo checkout. |
| *Pagamento e faturas* | `POST /billing/portal` → Customer Portal do Stripe: trocar cartão, baixar faturas, cancelar ao fim do período. |

### Ciclo mensal

```
Stripe cria a fatura do novo ciclo (invoice.created, billing_reason = subscription_cycle)
   └─ addOverage(): reconcile() do mês que fechou → usage_counters.overageAmount
      └─ > 0 ? InvoiceItem "Excedente de uso — 2026-09 (N msgs, M templates)" na MESMA fatura
Stripe finaliza e cobra (~1 h depois)
   ├─ invoice.paid          → invoices.status = paid; assinatura past_due/suspended volta a active
   └─ invoice.payment_failed → subscription.past_due, graceUntil = hoje + plan.limits.graceDays
Job diário (03:00 UTC, BillingProcessor)
   └─ past_due com graceUntil vencido → suspended
```

**Suspensa** = `UsageService.canSend` bloqueia envio; os números **continuam recebendo** (histórico preservado, cliente não some). Pagou → `invoice.paid` reativa.

Fatura espelhada em `invoices` com `hostedUrl` (link do Stripe para pagar/baixar) — aparece na tabela de faturas em *Plano e uso*.

### Financeiro (dono do Atendo)

Tela *Financeiro (dono)* (`GET /billing/finance`), quatro abas:
- **Visão geral** — MRR/ARR, clientes ativos/teste/cancelados, valor em atraso, margem estimada do mês; gráfico Faturado × Recebido × Custo por mês; MRR por plano; novos clientes por mês.
- **Assinaturas** — cada cliente com plano, mensalidade, status, renovação, cancelamento agendado, carência.
- **Faturas** — todas as faturas (espelho do Stripe) com link.
- **Margem por cliente** — a tabela abaixo.

### Margem (dono do Atendo)

`GET /billing/margin?period=YYYY-MM` (super_admin) e tela *Margem (dono)* no menu: por cliente, `receita (plano + excedente) − custo (Σ providerCost dos templates + Σ infraCostMonth dos números)`. Margem < 30% fica em laranja — é o sinal de plano mal precificado.

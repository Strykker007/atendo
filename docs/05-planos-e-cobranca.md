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
  graceDays: 7                    // tolerância após falha de pagamento
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

## Fechamento do período (a implementar)

1. `reconcile()` do mês.
2. `Invoice`: `baseAmount = plan.priceMonth`, `overageAmount` do `usage_counters`, `total`.
3. Envia ao gateway (Asaas ou Stripe) → `externalId`.
4. Webhook do gateway: pago → `paid`; falhou → `subscription.status = past_due`, `graceUntil = hoje + graceDays`.
5. Passou do grace sem pagar → `suspended`: números **param de enviar mas continuam recebendo** (histórico preservado, cliente não some).

## Relatório de margem (a implementar)

Por tenant/mês: `receita (plano + excedente) − custo (Σ providerCost + Σ infraCostMonth dos números)`. Tudo já está no banco; falta o endpoint e a tela no painel do super_admin. É aqui que se descobre se um plano está mal precificado.

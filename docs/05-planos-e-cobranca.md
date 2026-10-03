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

Seed cria três: Starter (fixo, `hardLimit: true`), Pro e Business (híbridos com excedente).

### Onde o custo é cadastrado

O "custo do mês" do Financeiro soma três coisas, e duas delas precisavam de cadastro:

| Custo | Onde se cadastra | Natureza |
|---|---|---|
| **Por cliente do plano** (`plans.costMonth`) | Planos → campo *Custo por cliente* | estimativa do dono: suporte, infra rateada, licenças |
| **Por linha** (`whatsapp_numbers.infraCostMonth`) | Números → *Custo mensal desta linha*, visível **só para o dono** (inclusive entrando como o cliente) | servidor, chip, taxa do provider |
| **Por mensagem** (`provider_pricing`) | tabela, por enquanto só no seed | medido no ledger a cada envio |

Os dois primeiros não existiam em lugar nenhum: `infraCostMonth` estava no banco mas **nenhuma rota escrevia nele**, então o custo de infra era sempre zero, e não havia custo por plano. Resultado: a margem do Financeiro era, na prática, a receita.

O campo da linha é descartado quando quem edita não é o dono — silenciosamente, porque um 403 confirmaria que o campo existe. Como o dono mexe nisso **entrando como o cliente**, a checagem aceita também o token de impersonação (que carrega papel de admin do cliente).

Com custo cadastrado, **Planos** passa a mostrar a margem por plano no cartão e o **Financeiro** mostra margem por plano ao lado do MRR. Sem custo, a margem não aparece: "margem = receita" é mentira confortável, e é o tipo de número que vira decisão de preço.

### Criar e editar planos (dono do sistema)

Tela **Planos**, na área do dono. Até então o catálogo só existia no seed: criar um pacote para um cliente exigia mexer no código, e por isso nenhum plano novo nascia — a transmissão em massa ficou pronta e trancada por falta de um plano que a liberasse.

A tela cobre tudo que o `PlanLimits` aceita: limites de números e usuários, unidade de cobrança (conversa ou mensagem), incluídos, excedentes, bloquear x cobrar, tolerância no pagamento, funcionalidades plugáveis e os três controles de IA (interações incluídas, excedente e **teto de custo**).

**Stripe:** ao salvar, o produto e o preço recorrente são criados automaticamente. Quando a cobrança está ligada e o plano fica sem preço, o cartão mostra "sem Stripe" — porque sem preço o cliente não consegue assinar, e descobrir isso no clique do checkout é tarde.

**Mudar o valor de um plano existente** cria um preço novo no Stripe e arquiva o anterior: preço é imutável lá. **Quem já assina continua no antigo** até trocar de plano — reajustar por baixo seria mexer no que o cliente contratou sem avisar.

### Reajuste de quem já assina

No Stripe o preço de uma assinatura **não muda sozinho**: sem nada, quem entrou hoje pagaria o preço de hoje daqui a dez anos. Era a única parte do faturamento que só andava para trás.

Ao mudar o preço de um plano que tem assinante, a tela pergunta o que fazer com ele:

| Opção | O que acontece |
|---|---|
| **Manter** (padrão) | Ninguém é tocado. O valor novo vale só para quem assinar daqui para frente. |
| **Avisar e reajustar** | Grava a data (`plans.priceAppliesToExistingAt = hoje + aviso prévio`, padrão 30 dias) e manda o e-mail **na hora do agendamento** — a graça do aviso prévio é o cliente ter tempo de decidir, inclusive de sair. |
| **Aplicar agora** | Sem aviso. Existe para corrigir preço digitado errado, não para reajustar. |

A rotina diária (`BillingProcessor`, 03:00 UTC) aplica os reajustes vencidos: troca o `price` do item da assinatura no Stripe com **`proration_behavior: 'none'`** — o valor novo entra na próxima fatura inteira, em vez de gerar uma cobrança quebrada no meio do mês —, grava `subscriptions.priceMonth` e manda a confirmação. Falha de um cliente não impede os outros, e o plano sai da fila mesmo assim: quem não migrou continua aparecendo como "no preço antigo" em vez de o sistema insistir calado todo dia.

`subscriptions.priceMonth` é **o preço contratado por aquele cliente** e é a fonte da verdade do que ele paga: alimenta o painel dele, o MRR e a margem. Somar `plans.priceMonth` inflaria a receita com um valor que ninguém está pagando. É gravado em toda atribuição de plano (criação pelo dono, troca de plano, webhook do Stripe — neste último vindo do valor real do item da assinatura).

Verificado em modo de teste com assinatura real no Stripe: agendamento mantém o cliente em R$ 597 e avisa; aplicação troca para R$ 697 com **zero itens de proporcional** e próxima fatura de R$ 697; e uma mudança sem aplicar deixa o cliente intacto no Stripe, marcado como "1 no preço antigo".

**Apagar** só é permitido quando ninguém assina; com assinante, a API responde 400 e a tela desabilita o botão, porque apagar levaria junto o histórico de faturamento. O caminho é **desativar**: some do checkout e quem já assina continua. Ao apagar, o produto também é arquivado no Stripe.

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


## IA: cobrança por interação

A IA tem ledger próprio (`ai_usage`) e contadores próprios, pelo mesmo motivo das
mensagens: sem medir, não dá para saber se dá lucro.

O cliente compra **interações de IA**, não token — uma interação é uma chamada ao modelo
(sugestão, reescrita, resumo ou resposta do robô). Em `PlanLimits`:
`includedAiInteractionsMonth`, `overagePricePerAiInteraction` e `aiMonthlyCostCap`.

O `aiMonthlyCostCap` é um **teto de custo real em BRL** e corta o uso mesmo de quem está
pagando excedente. Mensagem tem custo previsível por unidade; IA não — um fluxo mal montado
pode chamar o modelo em loop. A quota protege o cliente de fatura surpresa; o teto protege você.

Detalhes, tabela de preços por modelo e como calibrar o preço: [15](15-ia.md).


## Unidade de cobrança: conversa ou mensagem

O ledger registra **as duas** sempre; `PlanLimits.billingUnit` decide qual **limita** o
plano e qual gera excedente. Ausente = `messages` (planos criados antes da opção).

| Unidade | O que conta | Quando usar |
|---|---|---|
| `messages` | cada mensagem **enviada** | custo previsível por unidade; bom para quem manda pouco e recebe muito |
| `conversations` | uma **janela de 24h** com o mesmo contato no mesmo número | é como a Meta cobra; bom para atendimento, onde uma conversa tem dezenas de mensagens |

Template tem limite próprio nas duas unidades.

A janela de conversa é aberta no `conversation_usage` quando chega ou sai a primeira
mensagem daquele contato e não há janela aberta. A trava é um `SET NX` no Redis com TTL de
24h: **atômica**, porque duas mensagens simultâneas do mesmo contato não podem abrir duas
janelas e cobrar em dobro. O ledger no Postgres continua sendo a fonte da verdade, e a
reconciliação diária reconstrói o contador a partir dele.

## Resultado do atendimento

Ao encerrar, o atendente registra **comprou** (com valor) ou **não comprou** (com motivo).
Isso alimenta os indicadores de venda em Relatórios — faturamento, taxa de conversão e onde
o negócio se perde — e as métricas `revenue`, `won`, `lost` e `win_rate` no construtor.

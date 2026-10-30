# Gasto com a Meta (API oficial)

Painel para o **cliente** acompanhar quanto está gastando com a API oficial do WhatsApp no mês.
A Meta cobra o cliente **direto** (cartão cadastrado na WABA dele): o Atendo não fatura isso, só
mostra, projeta e avisa. Fica em **Plano e uso → Gasto com a Meta**, só para quem tem
`billing.manage` e só quando o cliente tem número oficial.

## De onde vêm os números

| Valor | Fonte | Quando |
|---|---|---|
| **Estimativa do Atendo** | ledger `message_usage.providerCost` (preço de `provider_pricing` no envio, em BRL) | na hora, a cada envio |
| **Valor apurado pela Meta** | `meta_cost_daily`, lido do `pricing_analytics` da WABA | a cada 6 h (job `meta-costs`, minuto 20) e no botão **Atualizar** (no máximo 1× a cada 10 min por cliente) |
| **Projeção do mês** | maior entre estimativa e real (em BRL) ÷ dias decorridos × dias do mês | só no mês corrente |

O valor da Meta é o que vale: a estimativa não sabe, por exemplo, que template de utilidade
dentro da janela de 24 h é grátis desde 07/2025, nem as faixas de volume. A Meta fecha o dia
com algumas horas de atraso, por isso o job relê o **mês inteiro** a cada rodada e regrava os dias
do número; nos 3 primeiros dias do mês também fecha o mês anterior.

**Uma WABA, vários números:** o `pricing_analytics` é pedido com a dimensão `PHONE` e cada número
do Atendo fica só com os pontos do seu telefone — a WABA pode ter números de outros sistemas.

**Moeda:** o real vem na moeda da WABA (`currency`, BRL ou USD). Moedas diferentes não são
somadas; se a WABA for em USD, o orçamento compara só com a estimativa em reais.

## Orçamento e aviso

`tenants.metaBudgetMonth` (R$). Ao passar de **80%** e **100%** do maior entre estimativa e real
em reais, os admins do cliente recebem e-mail (`usage_alerts.metric = 'meta_cost'`, um por
limiar por mês). **Não bloqueia** envio — a Meta cobra o cliente, a decisão de parar é dele.
Mudar o orçamento apaga os avisos do mês, que voltam a valer contra o valor novo. A conferência
roda a cada template pago enviado (`UsageService.record` → `checkMetaBudget`) e depois de cada
leitura da Meta.

## API

| Método | Rota | Quem | O quê |
|---|---|---|---|
| GET | `/billing/meta-costs?period=YYYY-MM` | `billing.manage` | Estimativa, real, projeção, orçamento, por número, por tipo (`byCategory.real` com `pricingType`: `REGULAR`, `FREE_CUSTOMER_SERVICE`, `FREE_ENTRY_POINT`) e por dia |
| POST | `/billing/meta-costs/refresh` | `billing.manage` | Relê da Meta agora (400 se leu há menos de 10 min) |
| PATCH | `/billing/meta-budget` | `billing.manage` | `{budget: number \| null}` — null/0 remove |

## Transmissão

Antes de disparar pela API oficial, a tela mostra a previsão (`POST /campaigns/estimate` na
criação, `GET /campaigns/:id/estimate` no Iniciar de um rascunho — só os alvos pendentes):

- **Custo na Meta:** alvos × preço da categoria do template (`provider_pricing`), e o gasto do
  mês antes → depois, contra o orçamento.
- **Trava o início** (`blockers`, também conferidos em `CampaignsService.start`): número
  desconectado, template que não está mais aprovado ou não suportado, plano que não deixa enviar
  template agora (`UsageService.canSend('templates')`: suspenso, aguardando ativação, cota fixa
  esgotada).
- **Avisa** (`warnings`): cota de templates do plano menor que o público (fixo: pausa quando
  acabar; com excedente: valor na próxima fatura do Atendo), orçamento estourado, marketing
  (a Meta limita por pessoa e não cobra o que não entrega) e categoria sem preço cadastrado.

No meio do disparo, se a cota de templates acabar, a transmissão **pausa sozinha** com o motivo
(`CampaignProcessor`), em vez de falhar contato a contato.

## Requisitos na Meta

O token do número precisa de `whatsapp_business_management` (o mesmo que lista templates). Sem
ele, a leitura falha e só a estimativa aparece (log `gasto da Meta não lido`).

Código: `apps/api/src/modules/billing/meta-costs.module.ts`, `MetaProvider.pricingAnalytics`,
`UsageService.metaSpend/checkMetaBudget`; tela `components/billing/MetaCostsSection.tsx`.
Migration `20270126000000_meta_costs`.

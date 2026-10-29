# 36 — Fechamento financeiro (dono do sistema)

**Financeiro → Fechamento** (`/admin/fechamento`, só `super_admin`). Responde no fim do mês: quanto era para entrar, quanto entrou, quem está devendo, quanto saiu (impostos, custos, despesas, folha, pró-labore), o que falta pagar, quanto fica no caixa e **quanto cada sócio recebe**. Código: `apps/api/src/modules/billing/finance-closing.service.ts` (+ `.controller.ts`), tela `apps/web/src/app/(app)/admin/fechamento/page.tsx`, grupos, formas de pagamento e frequências em `packages/shared/src/finance.ts`; as categorias são cadastráveis (`finance_categories`).

## De onde vem cada número

| Número | Fonte |
|---|---|
| **Recebido de clientes** | Faturas `paid` com `paidAt` no mês (Asaas, Stripe e a [cobrança de ativação](05-planos-e-cobranca.md#cobrança-de-ativação)) + recebimentos por fora lançados aqui (`finance_entries` com `tenantId`). **Regime de caixa**: conta no mês em que o dinheiro entrou |
| **Outras entradas** | Lançamentos de entrada recebidos, sem cliente (serviço avulso, instalação recebida por fora…) |
| **Impostos / Custos do serviço / Despesas / Folha e encargos / Pró-labore** | Saídas **do mês a que pertencem** (competência, `finance_entries.period`), **pagas ou não**: a linha vem do grupo da categoria. Riscado (`skipped`) não soma |
| **Resultado** | recebido + outras entradas − impostos − custos − despesas − folha − pró-labore |
| **Reserva** | `finance_settings.reservePercent` do resultado (se positivo) fica no caixa |
| **A distribuir** | resultado − reserva (nunca negativo). Dividido pelos % dos sócios ativos; o centavo do arredondamento vai para o último |
| **Previsto no mês** | Tudo que **vence** no mês: faturas (`dueAt`) + mensalidades sem gateway (`subscriptions.currentPeriodEnd`) + o que foi recebido por fora no mês |
| **Caixa hoje** | saldo inicial + tudo que entrou − tudo que foi **pago** (`paidAt` até agora) − partes de sócios marcadas como pagas, desde a data do saldo inicial. Embaixo: total a pagar em aberto e quanto já venceu |

Mensalidade **sem gateway** (cobrada à mão) entra como a receber quando `active`/`past_due`/`suspended`, plano pago, sem ativação pendente e cliente ativo. Valor = contratado (negociado), senão o do plano × unidades.

## Qual mês se fecha (e quando)

**Só fecha mês que já terminou.** No dia 5/11 o que se fecha é **outubro** — novembro está em andamento (ainda entra e sai dinheiro com data dele) e a API recusa (`400`) fechar o mês atual ou futuro.

- A tela abre no mês atual, marcado *Mês em andamento — fecha a partir de 01/12*; no lugar do botão aparece essa data.
- Se o **mês passado** ainda não foi fechado, uma faixa no topo avisa ("Outubro já terminou e ainda não foi fechado") com **Ir para outubro**.
- O botão diz o mês (**Fechar outubro de 2026**) e a confirmação repete o intervalo (01/10 a 31/10/2026), o resultado e o valor a distribuir.
- **Entradas por caixa, saídas por competência**: cada mês soma o dinheiro que **entrou** naqueles dias e as contas **daquele mês** (pagas ou não). Assim o DAS de outubro, que vence em 20/11, já sai do resultado de outubro — não se distribui aos sócios dinheiro que tem imposto a pagar.
- Entrada: A mensalidade que venceu em outubro e foi paga em 03/11 conta em **novembro** — então fechar outubro no dia 5 não "perde" nada: o que entrou em novembro é de novembro.
- Depois de fechado, nada com data daquele mês entra sem reabrir: lançamento e "Recebi" são recusados. Se um pagamento do Asaas chegar com data do mês já fechado (webhook atrasado), o mês continua congelado e mostra o aviso com o resultado novo — reabrir e fechar de novo atualiza.

## Aba Mês

- Seletor de mês (até o atual) e cartões: previsto (e quanto falta), recebido, saídas do mês (e quanto ainda está a pagar), resultado, caixa (e o total a pagar/vencido).
- **Fechamento**: a conta linha a linha (acima) e a **parte de cada sócio** (com a chave Pix para copiar).
- **Fechar** (só mês terminado — ver acima) congela os números (`finance_closings.summary` e `payouts`) e trava os lançamentos do mês (API responde 400). Exige a soma dos sócios ativos = 100% quando há o que distribuir. Depois de fechado: **Paguei** em cada sócio abre a data do pagamento (hoje por padrão; entre o 1º dia do mês fechado e hoje) — sai do caixa nesse dia. Clicar no selo "Pago dd/mm" muda a data ou desfaz; **Reabrir** desfaz o fechamento (inclusive as marcações). Se entrar dinheiro com data do mês depois de fechado, aparece o aviso com o resultado novo.
- **Mensalidades e cobranças do mês**: cada vencimento com origem (Pix/Asaas, Cartão/Stripe, Por fora, Ativação), situação (Recebido, A vencer, Atrasado), filtro e busca. No mês atual também aparecem os vencidos de meses anteriores ainda em aberto. Ações: cobrar no WhatsApp, copiar/abrir o link de pagamento, **Recebi** (só sem gateway).
- **Lançamentos do mês**: filtro por grupo (Entradas, Impostos, Custos do serviço, Despesas, Folha, Pró-labore) e por situação (em aberto/pagos), com o saldo do filtro. Cada linha mostra vencimento, fornecedor, nº do documento, parcela, forma de pagamento, selo *fixo*/*automático* e a situação (Pago dd/mm, A pagar, Vencido). Ações: **Pagar/Recebi** (baixa), desfazer a baixa, editar, excluir.
  - Custos fixos, folha e impostos automáticos entram **sozinhos** ao abrir o mês (um por fixo/imposto: `@@unique([recurringId, period])`, `@@unique([taxRuleId, period])`); no mês em que não houver, a lixeira **risca** (`skipped`) em vez de apagar — apagar faria ele voltar.
  - Parcela: excluir pergunta se apaga também as seguintes em aberto (`DELETE …?all=1`).

### Lançar (saída ou entrada)

| Campo | Para quê |
|---|---|
| Tipo | Saída (imposto, custo, despesa, folha) ou Entrada |
| Categoria | Agrupada pelo grupo do fechamento; só as ativas |
| Fornecedor / favorecido | Cadastro de fornecedores, com **＋ Cadastrar novo…** no próprio seletor |
| Descrição, Valor | — |
| Parcelas | À vista até 60x (saída nova). O valor é **de cada parcela**; cria uma por mês (vencimento e competência andam juntos), descrição "(1/3)", mesmo `installmentGroup`. Só a 1ª pode nascer paga |
| Vencimento | Dia da conta (entrada: dia do recebimento) |
| Situação | **Já paguei** (com a data) ou **Em aberto** (vai para Contas a pagar). Saída que vence até hoje sugere paga; futura, em aberto |
| Forma de pagamento | Pix, boleto, cartão de crédito/débito, débito automático, transferência, dinheiro |
| Nº da nota / guia / boleto, Observações | Referência para conferir depois |
| Mês em que conta (competência) | Padrão = mês do vencimento; **mudar** para, por exemplo, lançar a guia de outubro que vence em novembro em outubro. Fixo e imposto automático ficam no mês deles |

**Pagar** (`POST /entries/:id/pay {date, amount?, paymentMethod?}`): data, valor pago (juros, guia diferente) e forma. Vale **até em mês fechado** — muda o caixa, não o fechamento; mudar o valor de mês fechado é recusado (reabra). `{date: null}` desfaz a baixa. Corrigir o valor de um imposto automático trava o recálculo dele (`amountLocked`).

## Aba Contas a pagar

Toda saída em aberto (`paidAt` nulo, não riscada), de qualquer mês, por vencimento (`GET /billing/closing/payables`). Cartões: vencidas, vencem em 7 dias, total em aberto (inclui parcelas futuras). Filtros: todas / vencidas / próximos 7 / próximos 30 dias, grupo e busca (descrição, fornecedor, categoria). Cada linha diz há quantos dias venceu ou em quantos vence, e tem **Pagar**.

## Aba Em atraso

Tudo que venceu e não foi pago, de qualquer mês: faturas `open`/`failed` vencidas + mensalidades sem gateway com vencimento passado. Ordenado pelo maior atraso. Cartões (total, clientes devendo, mais de 30 dias), busca, origem e faixa de atraso (até 7, 8–30, 30+). Ações por linha:

- **Cobrar no WhatsApp** — abre o WhatsApp de quem clicou (`wa.me`) com a mensagem pronta (valor, vencimento e o link de pagamento, se houver) para o telefone do cadastro do cliente. Não sai pelo número de nenhum cliente.
- **Copiar / abrir link de pagamento** (Asaas/Stripe).
- **Suspender** — `PATCH /tenants/:id {subscriptionStatus: 'suspended'}`: bloqueia o envio, o recebimento continua.
- **Recebi** — só para quem paga por fora (ver abaixo). Cobrança do Asaas/Stripe dá baixa sozinha.
- Clicar no nome abre o cliente em Clientes.

## Recebi (mensalidade por fora)

`POST /billing/closing/receive/:tenantId {amount?, date?}`: lança a entrada (`mensalidade`, com `tenantId`) no dia escolhido e a assinatura **anda um ciclo** a partir do vencimento (`currentPeriodStart` = vencimento antigo, `status = active`, sem carência). Recusa cliente com gateway e mês fechado.

## Aba Cadastros

- **Sócios**: nome, % e chave Pix; inativo sai da divisão. Mostra a soma (precisa dar 100%).
- **Caixa**: reserva antes de dividir (%), saldo inicial e a data dele.
- **Impostos automáticos** (`finance_tax_rules`): nome, categoria (grupo Impostos), alíquota (%), base (*tudo que entrou no mês* ou *só o recebido de clientes*), dia do vencimento no mês seguinte e mês de início. Todo mês aberto ganha o lançamento com `base × %`, competência no próprio mês e vencimento no seguinte; **recalcula** enquanto o mês está aberto, o lançamento não foi pago e o valor não foi corrigido à mão. Desligar/remover tira dos meses abertos o que ainda não foi pago. Serve para Simples Nacional (alíquota efetiva do DAS), ISS, PIS/COFINS, IRPJ/CSLL do presumido…
- **Folha de pagamento e pró-labore** e **Custos e despesas fixos** (`finance_recurring`): categoria, fornecedor, descrição, valor, frequência (todo mês, a cada 3 ou 6 meses, anual — contada do mês de início), dia do vencimento (1–31; 31 em mês curto vira o último dia), mês de início, mês final opcional (parcelamento), forma de pagamento, **débito automático** (já nasce pago no dia) e observações. Novo vale a partir do mês de início; editar atualiza o lançamento do mês aberto (os fechados ficam como foram); remover tira do mês aberto e mantém o histórico. O total mostra o equivalente mensal.
- **Categorias** (`finance_categories`): nome + grupo (Entradas, Impostos, Custos do serviço, Despesas, Folha e encargos, Pró-labore). As de fábrica (`system`, id legível como `das`, `infra`, `folha`) podem ser renomeadas e desativadas, não mudam de grupo nem se apagam. Categoria em uso não se apaga: é desativada. Com lançamentos, não troca entre entrada e saída.
- **Fornecedores** (`finance_suppliers`): nome, CPF/CNPJ (validado), chave Pix (copiar) e observações. Em uso, excluir desativa.

## API (`super_admin`)

| Método | Rota | O quê |
|---|---|---|
| GET | `/billing/closing/month/:period` | `{summary, liveSummary, payouts, expected, pending, receivables[], entries[], cash, closed}` (gera os fixos do mês) |
| POST | `/billing/closing/month/:period/close` · `/reopen` | Fecha (`{notes?}`) / reabre |
| PUT | `/billing/closing/month/:period/payouts/:partnerId` | `{paid, date?}` — sócio recebeu (`date` AAAA-MM-DD, padrão hoje; não pode ser futura nem antes do mês) |
| GET | `/billing/closing/overdue` | Em atraso |
| POST | `/billing/closing/receive/:tenantId` | Recebi por fora |
| POST/PATCH/DELETE | `/billing/closing/entries[/:id]` | Lançamentos `{category, description, amount, date, period?, paidAt?, paymentMethod?, documentNumber?, notes?, supplierId?, installments?}`; PATCH também `skipped`; DELETE `?all=1` nas parcelas |
| POST | `/billing/closing/entries/:id/pay` | Baixa `{date, amount?, paymentMethod?}`; `{date: null}` desfaz |
| GET | `/billing/closing/payables` | Contas a pagar em aberto |
| GET | `/billing/closing/config` | Sócios, fixos, categorias, fornecedores, impostos e configuração |
| POST/PUT/DELETE | `/billing/closing/categories[/:id]` | Categoria `{name, section, isActive?}` |
| POST/PUT/DELETE | `/billing/closing/suppliers[/:id]` | Fornecedor `{name, document?, pixKey?, notes?, isActive?}` |
| POST/PUT/DELETE | `/billing/closing/tax-rules[/:id]` | Imposto automático `{name, categoryId, percent, base?, dueDay?, isActive?, startPeriod?}` |
| PUT | `/billing/closing/settings` | `{reservePercent?, openingBalance?, openingDate?}` |
| POST/PUT | `/billing/closing/partners[/:id]` | Sócio |
| POST/PUT/DELETE | `/billing/closing/recurring[/:id]` | Custo fixo / folha `{category, description, amount, dayOfMonth?, frequency?, startPeriod?, endPeriod?, autoPaid?, paymentMethod?, supplierId?, notes?, isActive?}` |

## Modelo

`finance_entries`, `finance_recurring`, `finance_partners`, `finance_closings`, `finance_settings` — migração `20270121000000_finance_closing` (só tabelas novas). `finance_categories` (com as de fábrica), `finance_suppliers`, `finance_tax_rules` e as colunas de contas a pagar/parcelas/fornecedor — migração `20270122000000_finance_costs` (aditiva: os lançamentos antigos ficam pagos na data deles e os fixos antigos, como débito automático). Ver [06 — Modelo de dados](06-modelo-de-dados.md).

## Limites

- Taxa do Asaas não é descontada sozinha: o recebido é o valor bruto da cobrança. Lance em *Taxas de cobrança (Asaas, banco)* — ou crie um imposto automático com a % média, na categoria que preferir do grupo Impostos.
- O cartão "Em atraso" da Visão geral do Financeiro conta só faturas; a aba Em atraso daqui inclui também as mensalidades por fora.
- O imposto automático é uma % fixa sobre o que entrou: a faixa do Simples que muda com o faturamento dos últimos 12 meses não é calculada — atualize a alíquota quando mudar, ou corrija o valor pela guia.
- Sem anexo de comprovante/nota (use o nº do documento e as observações).

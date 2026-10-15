# Metas de consultores

Meta **mensal** de vendas por consultor, vista e ranqueada em **Relatórios → Ranking e metas →
Metas do mês** (`/relatorios/ranking`). Recurso de plano `consultant_ranking` (o mesmo do ranking).

## Como configurar

Botão **Definir metas** (permissão `team.manage`: admin e gerente):

- **Meta padrão** do mês: vale para todo usuário com papel de **atendente** ativo que não tenha
  meta própria.
- **Meta de cada consultor**: faturamento (R$) e/ou quantidade de vendas. Vazio = usa a padrão.
- **Copiar do mês anterior** preenche o editor com as metas do mês passado (só salva ao clicar).

Salvar substitui as metas do mês inteiro (`PUT /sales-goals/:month`).

## Como é calculado (`goal-progress.ts`)

- **Realizado** = vendas do consultor no mês, pela régua comum com o ranking e a visão pronta
  (`common/reports/sales-base.ts`): encerramentos "Comprou" (`conversation_events`, com ator, fora
  os internos) **+** orçamentos pagos que ainda não entraram num encerramento (do atendente que
  gerou, pela data do pagamento) **−** estornos. Encerramento que absorveu o orçamento conta uma vez
  só — ver [Orçamentos › Venda](orcamentos.md#venda).
- **Mês** = mês no fuso do cliente (`tenant_settings.timezone`).
- **% atingido** = realizado ÷ meta. Com meta de valor **e** de quantidade, o atingimento é a média
  das duas, e é ele que ordena o ranking.
- **Esperado hoje** = meta × fração do mês que já passou (ritmo linear). A marca na barra mostra
  esse ponto.
- **Projeção** = realizado ÷ fração do mês: onde termina se mantiver o ritmo.
- **Situação**: *Meta batida* (≥ 100%), *No ritmo* (≥ esperado), *Perto* (≥ 80% do esperado),
  *Atrás*. Com duas metas vale a pior — bater o valor com uma venda grande não esconde a
  quantidade parada.
- Quem vendeu sem meta aparece no fim, sem posição.

## Dados

`sales_goals` (`tenantId`, `month` "AAAA-MM", `userId` — `'*'` = meta padrão —, `revenueTarget`,
`wonTarget`), único por `(tenantId, month, userId)`. Sem FK no usuário: o `'*'` não é usuário e
a meta de quem saiu continua no histórico. Migração `20261130000000_sales_goals`.

## API

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/sales-goals/:month` | `reports.view` | `{month, default: {revenueTarget, wonTarget} \| null, goals[{userId, revenueTarget, wonTarget}]}` |
| PUT | `/sales-goals/:month` | `team.manage` | `{default?, goals[]}` — substitui o mês; usuário de outro cliente = 400; limpa o cache do progresso |
| GET | `/reports/goals?month=AAAA-MM` | `reports.view` | Progresso: `{month, elapsedPct, team{revenue, revenueTarget, revenuePct, won}, ranking[{position, userId, name, goalSource: own\|default\|null, revenue, won, revenueTarget, wonTarget, revenuePct, wonPct, revenueExpected, revenueProjection, wonProjection, attainment, status}]}`. Sem `month` = mês atual |

Todas exigem o recurso `consultant_ranking` no plano (403 sem ele).

## Ranking

A posição do **Ranking do período** é uma **pontuação de 0 a 100** (`packages/shared/src/ranking.ts`), e não mais só a quantidade de vendas — que premiava quem pegava mais fila, não quem atendia melhor.

Cada métrica vira 0–100 em relação ao melhor do período; a nota é a média ponderada:

| Métrica | Como vira 0–100 | Peso padrão |
|---|---|---|
| Faturamento | faturado ÷ maior faturado | 35 |
| Vendas | vendas ÷ maior número de vendas | 20 |
| Conversão | (vendas + 1) ÷ (concluídos + 2), ÷ a maior — suavizada: 1 venda em 1 atendimento não vale 100% | 20 |
| Satisfação | média da pesquisa ÷ teto da escala | 15 |
| Tempo de atendimento | TMA mais rápido ÷ TMA do consultor (o mais rápido = 100) | 10 |

Sem dado (nenhuma resposta de pesquisa, sem TMA), a métrica não conta e o peso dela vai para as outras — ninguém leva zero por não ter recebido pesquisa. Empate → faturamento → vendas → nome.

**Pesos**: botão **Pesos** na tela (`settings.manage`), 0 a 100 cada — vale a proporção; zero tira a métrica. Gravados em `tenant_settings.rankingWeights` (nulo = padrão; migração `20261207000000_ranking_weights`). A tabela ganhou as colunas **Pontuação** (passe o mouse: composição de cada parte) e **Faturamento**; clicar em qualquer coluna só reordena para conferir — o pódio e a posição seguem a pontuação.

Vendas, faturamento e concluídos usam a régua comum (`common/reports/sales-base.ts`): "Comprou" + orçamento pago sem encerramento − estornos ([Orçamentos › Venda](orcamentos.md#venda)).


# Relatórios sem pico no servidor

Relatório é a consulta mais pesada do sistema e o chat é o que não pode parar. As regras abaixo
valem para todo relatório (`/reports/*`, satisfação, metas). Código em
`apps/api/src/common/reports/report-load.service.ts`.

## O problema

A visão pronta de Relatórios dispara ~20 consultas de uma vez. O pool do Prisma tem poucas
conexões (núcleos × 2 + 1 — 5 numa máquina de 2 vCPU), então **uma** pessoa abrindo a tela
ocupava todas, e as consultas do chat (abrir conversa, mandar mensagem) esperavam na fila do pool.
Gerente apertando F5, várias abas e a tela recarregando ao voltar o foco multiplicavam isso.

## As defesas

| Defesa | Onde | Efeito |
|---|---|---|
| **Limite de concorrência** | `ReportLoadService.run` / `.all` | No máximo `REPORT_MAX_CONCURRENCY` (padrão **3**) consultas de relatório ao mesmo tempo por processo; o resto espera na fila do serviço, não no pool. Sempre sobra conexão para o atendimento |
| **Cache curto** | `ReportLoadService.cached` | Resultado no Redis por cliente + filtros: 60 s (visão pronta, ranking, relatório personalizado, metas) e 30 s (satisfação). Salvar metas apaga o cache do mês. Redis fora do ar = calcula sem cache |
| **Single-flight** | `cached` | Duas requisições iguais ao mesmo tempo esperam a mesma execução |
| **Teto de período** | `assertReportRange` | No máximo **400 dias** (e início antes do fim) — mais que isso é 400. Evita "desde 2020" varrendo a tabela de mensagens |
| **Paginação antes do pesado** | Auditoria de atendimentos | A página é escolhida primeiro (só ids, pelo índice); início do atendimento e contagem de mensagens são calculados só para as 25 linhas, não para o período inteiro |
| **Joins sob demanda** | `query()` | Cada join (mensagens, tags, números) entra só se a métrica/agrupamento usar |
| **Front sem refetch em foco** | hooks de relatório | `staleTime` 30–60 s e `refetchOnWindowFocus: false`: voltar à aba não dispara outra rodada |

Consequência visível: um encerramento novo pode levar até 1 minuto para aparecer na visão pronta
e no ranking. Listas paginadas (auditoria, vendas) não usam cache, só o limite.

## Índices que sustentam

- `conversation_events (tenantId, type, createdAt)` — encerramentos/reaberturas no período.
- `conversation_events (conversationId, createdAt)` — início do atendimento (lateral).
- `messages (conversationId, createdAt)` — contagens e 1ª resposta.
- `survey_responses (tenantId, sentAt)` e `(tenantId, agentId, sentAt)` — satisfação.
- `sales (tenantId, closedAt)` e `(tenantId, userId, closedAt)` — vendas.

## Ao criar um relatório novo

1. Toda consulta passa por `this.load.run(() => …)` (ou `this.load.all([() => …])`).
2. Resultado agregado (não paginado) vai por `this.load.cached(ReportLoadService.key(tenantId, 'nome', filtros), …)`.
3. Período passa por `assertReportRange(from, to)`.
4. Hook do front com `staleTime` e `refetchOnWindowFocus: false`.
5. Conversa de contato isento de ticket fica de fora: `not c."ticketExempt"` quando a consulta junta `conversations`, ou `semIsento(<coluna conversationId>)` quando não junta ([Contatos isentos](contatos-isentos.md)).

# Feedback de atendimento

O gestor abre um atendimento encerrado na auditoria e aponta algo para quem atendeu: **Correção**, **Oportunidade** (ex.: "vendeu 10 preservativos, mas poderia ter oferecido o lubrificante que estava em promoção"), **Orientação** ou **Elogio**. O atendente precisa ver e, conforme o tipo, dar ciência ("Li e estou ciente"), com resposta opcional.

O feedback fica **entre gestor e atendente**. O contato nunca vê. Os colegas também não, e é isso que o diferencia da nota interna, que fica na conversa para a equipe toda.

## Fluxo

1. **Gestor** (`reviews.manage`) dá o feedback por um de dois caminhos (ver [Onde dar](#onde-dar)). Escolhe o tipo, escreve o texto e, se quiser, clica nas mensagens para marcar o trecho (ficam em vermelho). Não é possível dar feedback para si mesmo. Linha da auditoria com feedback ganha o ícone 📋 com a contagem.
2. **Atendente**: recebe o aviso e abre o feedback em **Feedbacks** (menu Atendimento). Vê o texto e o atendimento em modo leitura, com o trecho em destaque, e clica em **Li e estou ciente**.
3. **Gestor** acompanha em Feedbacks → **Enviados** (só os que ele apontou, todos por padrão) ou → **Da equipe** (de todos os gestores, começando pelos sem ciência). Os filtros são: busca (contato, telefone, atendente ou texto), período (7/30/90 dias ou datas escolhidas), tipo, atendente e situação (sem ciência, prazo vencido, cientes, todos). Em "Todos", cada situação mostra a contagem. Em Enviados e Da equipe, os filtros vão para a API (até 300 por consulta). Em Recebidos, a busca, o tipo e o período filtram na própria tela. O aviso de ciência, resposta ou prazo vencido abre direto em Enviados. A linha de situação de cada um mostra: "ainda não entrou desde o feedback", "visto em…, sem ciência", "1h20 de 4h online" ou "ciente em…". O gestor pode **apagar** o feedback enquanto não houver ciência (engano); depois ele fica no histórico.

## Onde dar

- **Na própria conversa** (o caminho mais curto): cada linha "Atendimento encerrado" do chat ganha **📋 Dar feedback**. Para não poluir a conversa, o botão só aparece ao passar o mouse (no toque, fica sempre à vista). Atendimento que já tem feedback mostra o contador **📋 n** o tempo todo. O clique abre `AttendanceFeedbackModal`, com as mensagens daquele atendimento (do encerramento anterior até este; clicar marca o trecho) e o formulário. Vale na tela de conversas e no mini-chat do Kanban. O botão não aparece quando quem encerrou foi a automação (sem atendente) nem quando foi o próprio gestor.
- **Pela auditoria**: Relatórios → Auditoria de atendimentos → abrir um atendimento → **Dar feedback**. É o caminho para achar atendimentos por período, resultado, motivo ou atendente.

O texto sem feedbacks em *Feedbacks → Enviados* explica os dois caminhos.

## Garantia de leitura

São camadas, da mais leve para a mais forte:

- **Na hora**: cartão fixo no topo (som + notificação do computador, evento `review_alert`). É o mesmo padrão da transferência e da nota interna.
- **Contador** no item *Feedbacks* do menu, com os pendentes.
- **A cada entrada** (uma vez por sessão do navegador): se houver pendente, abre a tela "Você tem N feedbacks do gestor". As notas internas não lidas voltam como cartão.
- **Trava**: num tipo que trava (por padrão, só Correção), sem ciência a pessoa **não assume novo atendimento**. `POST /conversations/:id/claim` devolve `409 reviews_pending` e a tela de pendências abre. A distribuição automática da fila também não entrega para ela. Pegar de volta o que já é dela continua livre: ninguém fica preso no meio de uma conversa.
- **Prazo vencido**: avisa quem fez o apontamento (`review_alert` `overdue`), se a empresa deixou ligado.

"Visto" (abriu) e "ciente" (confirmou) são registrados separadamente (`seenAt` e `acknowledgedAt`).

## Prazo em horas online

O prazo **não** é em horas corridas. Ele conta só o tempo em que o atendente está **online**: painel aberto e dentro da escala. É a mesma presença do Distribuidor (`ConversationsGateway.onlineUserIds`, no Redis). Com isso, folga, fim de semana, férias, escala de outro dia e "não entrou" não consomem o prazo.

Implementação: um job no worker (`attendance-reviews`, a cada minuto, `upsertJobScheduler`) soma 1 minuto em `onlineMinutes` de cada pendente cujo atendente está online. Quando `onlineMinutes >= deadlineMinutes`, grava `overdueAt` e avisa o gestor. Se o job atrasar, o tempo fica a menos, nunca a mais.

## Configuração

Fica em Configurações → Atendimento → **Feedback de atendimento** (`settings.manage`). É por empresa, salva em `tenant_settings.reviewSettings` (JSON, null = padrão `REVIEW_SETTINGS_DEFAULT` em `packages/shared/src/reviews.ts`):

| Tipo | Exige ciência | Prazo (horas online) | Trava novo atendimento |
|---|---|---|---|
| Correção | sim | 4h | sim |
| Oportunidade | sim | 8h | não |
| Orientação | sim | 8h | não |
| Elogio | não (só ver) | — | não |

Mais: **avisar o gestor quando o prazo vencer** (padrão ligado). Desligar a ciência de um tipo também tira o prazo e a trava dele. A regra é **copiada no apontamento** (`requiresAck`, `blocksClaim`, `deadlineMinutes`): mudar a configuração depois não mexe nos feedbacks que já existem.

## Modelo

`AttendanceReview` (`attendance_reviews`, migration `20270219000000_attendance_reviews`):

- `conversationId` e `closeEventId` (o encerramento = a linha da auditoria);
- `windowStart`/`windowEnd`, a janela das mensagens: do encerramento anterior até este;
- `agentId`/`agentName` e `reviewerId`/`reviewerName` (nomes copiados);
- `kind`, `text`, `messageIds[]`;
- a regra copiada: `requiresAck`, `blocksClaim`, `deadlineMinutes`;
- `onlineMinutes`, `seenAt`, `acknowledgedAt`, `agentReply`/`repliedAt`, `overdueAt`.

Excluir a conversa apaga os feedbacks dela (cascade).

## API (`apps/api/src/modules/reviews`)

| Método | Rota | Quem | |
|---|---|---|---|
| GET | `/reviews/settings` | todos | regra da empresa (com o padrão aplicado) |
| PATCH | `/reviews/settings` | `settings.manage` | `{kinds: {correction: {requiresAck, deadlineHours, blocksClaim}, …}, notifyReviewerOnOverdue}` |
| GET | `/reviews/attention` | todos | `{reviews: {pending, blocking, items}, notes}`: o que mostrar ao entrar |
| GET | `/reviews/mine` | todos | os feedbacks recebidos (até 200) |
| GET | `/reviews?agentId=&status=&reviewer=me&kind=&from=&to=&search=` | `reviews.manage` | da equipe; `reviewer=me` = só os que eu enviei; `kind` = tipo; `from`/`to` = período do apontamento (ISO, `to` exclusivo); `search` = texto, atendente, nome ou telefone do contato; `status` = `pending`/`overdue`/`acknowledged`; traz `agentLastSeenAt` (último login) |
| GET | `/reviews/by-attendance?ids=` | `reviews.manage` | `{closeEventId: n}` para marcar a auditoria |
| POST | `/reviews` | `reviews.manage` | `{conversationId, closeEventId?, agentId?, kind, text, messageIds?}`. Sem `agentId`, vai para quem encerrou. Emite `review_alert` `new` |
| GET | `/reviews/:id` · `/reviews/:id/messages` | o atendente dele ou `reviews.manage` | o feedback e as mensagens da janela. Vêm por aqui, e não pela conversa, porque o atendente pode não enxergar mais a conversa |
| POST | `/reviews/:id/seen` | o atendente | marca visto |
| POST | `/reviews/:id/ack` | o atendente | `{reply?}`: ciência (e resposta). Depois da ciência, aceita uma resposta só. Emite `acknowledged`/`replied` para quem apontou |
| DELETE | `/reviews/:id` | `reviews.manage` | só antes da ciência |

## Permissão

`reviews.manage` (grupo Gestão). Entra no padrão de Administrador e Gerente: a migration acrescenta a permissão aos perfis padrão não editados. Todo mundo vê os **seus** feedbacks, sem permissão. A funcionalidade vem em todos os planos, sem `PlanLimits.features`. Se passar a ser cobrada à parte, entra lá.

## Front

- `components/feedback/Feedback.tsx`: `ReviewComposer` (na auditoria), `ReviewDetailModal`, `AttentionGate` (no shell) e `StatusLine`.
- `app/(app)/feedbacks/page.tsx`: abas Recebidos, Enviados e Da equipe (`?aba=enviados|equipe`); `?abrir=<id>` abre um feedback direto.
- `components/settings/ReviewsSection.tsx`.
- `lib/review-gate.ts`: `useClaim` abre a tela de pendências com `reviews_pending`.

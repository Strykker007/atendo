# Departamentos

Tarefa 5. Separa a fila de atendimento por área (Vendas, Suporte, Balcão, Orçamentos…): cada conversa pode estar em **um** departamento, cada pessoa pode participar de **vários**, e quem é de um departamento passa a ver só a fila dele.

## Como era antes (mapeamento)

- **Distribuidor** (`distributor`, `flow-engine.service.ts → distribute`): rodízio (`nextInRotation`, procura o último evento `transferred` com motivo `DISTRIBUTION_REASON`), menos ocupado (`leastBusy`, `groupBy` de conversas abertas) ou fila (`setStatusSystem('waiting')`). Candidatos: `agentIds` do bloco (ou todos os ativos), sempre filtrados por quem opera o número da conversa (`user_numbers`; sem linha = todos). Saídas `done` / `fallback`.
- **Atribuição**: `claim` (atômico), `transfer`, `release` em `ConversationsService`; Ação `assign`/`handoff` no motor. Cada mudança grava `conversation_events` e emite `conversation` no socket da sala do tenant.
- **Escopo de dados**: só por número (`auth/number-scope.ts`: lista vazia = todos), aplicado na lista, contadores, `ConversationScopeGuard` (rotas `:id`), encerrar em massa, encaminhar e Kanban. Visão de atendimentos dos outros por permissão (`conversations.view_all`).
- **Lista de conversas** (`components/chat/ConversationList.tsx`): seletor de número na barra superior, status com contadores, busca, filtros (tag, atendente, ordem, origem) atrás de ícone; estado em `lib/store.ts`.

Não existia nenhum conceito de departamento/setor.

## Dados

| Tabela/campo | O que é |
|---|---|
| `departments` | `tenantId`, `name` (único por cliente), `description?`, `color` (hex), `isActive` |
| `user_departments` | N:N usuário ↔ departamento. **Sem linha = sem restrição de departamento** |
| `conversations.departmentId` | opcional; nulo = sem departamento. Excluir o departamento põe `null` (`SetNull`) |
| `ConversationEventType.department_changed` | histórico; `reason` = `"Vendas → Suporte"`; ator nulo = fluxo |

Migration: `20261008000000_departments`.

## Quem vê o quê (`auth/department-scope.ts`)

**Restrito** = participa de pelo menos um departamento **e** não tem `conversations.view_all` (e não é super admin). Restrito vê as conversas **dos seus departamentos e as sem departamento**. Não restrito vê tudo.

- Lista vazia = todos: é o mesmo princípio dos números — ligar a funcionalidade não tranca ninguém. Para "fechar" a fila de alguém, coloque a pessoa num departamento.
- Conversa sem departamento é visível para todos: a que ainda não passou por triagem não pode sumir.
- Gerente/atendente líder (`view_all`) coordena e vê todos os departamentos.
- Departamento **desativado** continua valendo no escopo (as conversas dele continuam visíveis só para os participantes e para quem vê tudo).
- Escopo carregado junto com as permissões (`PermissionsService.scope`, cache de 15 s, limpo ao salvar participantes ou excluir um departamento) e exposto em `AuthUser.departmentIds`.

| Ponto | Comportamento |
|---|---|
| `GET /conversations` e `/conversations/counts` | escopo ∩ filtro `departmentId` (id ou `none`); pedir um departamento que não enxerga devolve lista vazia |
| Rotas `/conversations/:id/…` | `ConversationScopeGuard` (404, como no escopo por número) |
| Encerrar em massa, encaminhar, Kanban | mesmo recorte |
| Socket | o evento `conversation` continua indo para a sala do tenant (a tela só usa como sinal para recarregar, como já era com números) |

## Transferência manual

`PATCH /conversations/:id/department` `{ departmentId: uuid | null }`.

- Conversa aberta vai para a **fila** do departamento: sem dono, status *Aguardando*. Encerrada só troca o departamento.
- Pode: o dono, quem tem `conversations.transfer_any`, ou qualquer um que veja a conversa enquanto ela está sem dono (mesma regra do "Devolver à fila").
- Departamento de outro cliente ou desativado → 404. Igual ao atual → não faz nada.
- Grava `department_changed` e emite `conversation`.

## Fluxos

- **Distribuidor** — campo opcional **Departamento**: a conversa entra no departamento e só os **participantes ativos** dele concorrem (rodízio/menos ocupado), ainda filtrados pelo número e pelos atendentes marcados, se houver. Aqui "sem vínculo = todos" **não** vale: quem não está no departamento não recebe. Em modo fila, só põe no departamento e devolve para *Aguardando*. Departamento excluído/desativado → aviso para a equipe (`warnTeam`) e saída **Ninguém disponível**. Sem departamento no bloco = comportamento antigo.
- **Ação → Definir departamento** (`kind: 'set_department'`, `departmentId` ou `DEPARTMENT_NONE` = tirar): só troca o departamento, não mexe em dono/status, o fluxo segue. Departamento inexistente/desativado → aviso, conversa fica onde estava. Para entregar, encadeie com Distribuidor ou "Transferir para atendente humano".
- Validação: Ação "Definir departamento" sem departamento não salva (exceto card marcado *Reconfigurar*).
- Exportar/importar/colar em outra empresa: `departmentId` sai do bloco com aviso e marca *Reconfigurar* (`scrubFlowDefinition`); "Sem departamento" viaja como está.

## Telas

- **Configurações → Departamentos** (`components/settings/DepartmentsSection.tsx`, só com `team.manage`): lista com participantes e conversas abertas, interruptor liga/desliga, criar/editar (nome, descrição, cor, participantes, ativo) e excluir (confirmação explica que as conversas ficam sem departamento).
- **Lista de conversas**: seletor de departamento na barra superior, ao lado do número (aparece quando há departamentos): todos, cada departamento ativo, *Sem departamento*. Filtro guardado no navegador (`useUI.departmentId`); filtro de departamento excluído volta para "todos". Os contadores respeitam o filtro. Card mostra a etiqueta do departamento (`DepartmentBadge`).
- **Chat**: etiqueta no cabeçalho ao lado do canal; botão **Departamento** abre o menu de transferência (departamentos ativos + "Tirar do departamento"). Histórico mostra "mudou o departamento · Vendas → Suporte".
- **Editor de fluxos**: seletor de departamento no Distribuidor (a lista de atendentes passa a mostrar só os participantes) e na Ação "Definir departamento"; os cards mostram o departamento escolhido (ou "excluído").

## API

| Método | Rota | Permissão | |
|---|---|---|---|
| GET | `/departments` | todos | Lista com `users` e `_count.conversations` (abertas) |
| POST | `/departments` | `team.manage` | `{ name, description?, color?, isActive?, userIds? }` — 409 nome repetido |
| PATCH | `/departments/:id` | `team.manage` | mesmos campos; `userIds` substitui os participantes |
| DELETE | `/departments/:id` | `team.manage` | conversas ficam sem departamento |
| PATCH | `/conversations/:id/department` | ver acima | `{ departmentId: uuid \| null }` |

`GET /tenants/me/agents` passou a trazer `departments: { departmentId }[]`.

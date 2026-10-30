# Tickets internos

Pedidos **entre setores da mesma empresa** (portaria → administração, concierge → manutenção…). Menu **Tickets** (`/tickets`). Recurso do plano `tickets` (`@RequireFeature('tickets')` na API, item do menu some sem ele). Código: `apps/api/src/modules/tickets/tickets.module.ts`, tela `apps/web/src/app/(app)/tickets/page.tsx`, constantes em `packages/shared/src/tickets.ts`.

## O ticket

| Campo | O que é |
|---|---|
| Número | `#12`, sequencial por empresa (`@@unique([tenantId, number])`) |
| Título / detalhes | o que precisa |
| Setor | departamento de destino (opcional) |
| Prioridade | baixa, normal, alta, urgente |
| Prazo | dia (vale até 23:59 de Brasília); vencido aparece em vermelho |
| Atendimento | opcional: ligado à conversa aberta no momento (link na tela) |

**Situação** (`TICKET_STATUSES`): Aberto (ninguém responsável) → Em andamento (tem responsável) → **Em espera** (congelado) → Resolvido / Cancelado. Reabrir volta para em andamento (com responsável) ou aberto.

## Várias pessoas no mesmo ticket

`ticket_participants`: **um responsável** e quantos **participantes** precisar (até 20) — ex.: adm responde, portaria e concierge atuam junto. Incluir e tirar pessoas, **Assumir** (vira responsável; o anterior fica como participante), sair do ticket. Quem é incluído recebe aviso na hora.

## Congelar (Em espera)

O ticket para por **motivo externo**: esperando prestador, peça, morador, aprovação… Motivo (cadastrável), observação e **data para retomar** (opcional). Passou da data, o topo da tela avisa ("em espera passaram da data de retomar") — não retoma sozinho. **Retomar** volta para em andamento/aberto.

**Motivos de espera** (`ticket_hold_reasons`): toda empresa começa com os padrão (`DEFAULT_TICKET_HOLD_REASONS`, criados na primeira abertura da tela); quem tem `tickets.manage` inclui, desativa ou exclui (em uso, excluir só desativa).

## Transferir

Outro setor e/ou outro responsável, com recado. O responsável anterior fica como participante; quem transferiu escolhe se **continua acompanhando** (padrão) ou sai. Sem responsável, o setor assume.

## Linha do tempo

`ticket_events`: comentário e cada ação (abriu, situação, congelou/retomou com motivo, transferiu, incluiu/tirou pessoa, editou) com quem fez e quando. Comentário avisa todos que atuam e quem abriu.

## Quem vê e quem atua

| Permissão (perfil de acesso) | O que dá |
|---|---|
| `tickets.create` | abrir tickets |
| `tickets.handle` | ver e atuar nos tickets dos **seus setores** (sem setor na equipe = todos os setores) |
| `tickets.view_all` | ver todos os tickets da empresa |
| `tickets.manage` | atuar em qualquer ticket, cancelar e cadastrar motivos de espera |

Sempre: quem **abriu** vê, comenta e pode cancelar o próprio; quem é **responsável/participante** vê e atua. Padrão: Administrador e Gerente com as quatro; Atendente com abrir e atender (migration `20270125000000_tickets`, só perfis padrão não editados).

Abas: **Comigo** (sou responsável ou participante), **Do meu setor** (`tickets.handle`), **Que abri**, **Todos** (`view_all`/`manage`). Filtros: situação (padrão: em aberto), prioridade, setor, busca por título/descrição/#número.

## Avisos em tempo real

`ConversationsGateway.emitTicket`: evento `ticket` para a empresa (lista e detalhe recarregam) e `ticket_alert` só para quem passou a atuar ou deve saber (incluído, transferido, comentário, mudou de situação) — toast + som.

## API (`/tickets`, recurso `tickets`)

| Método | Rota | O quê |
|---|---|---|
| GET | `/tickets?scope=mine\|department\|created\|all&status=active\|<status>&priority=&departmentId=\|none&search=&page=` | lista (50 por página) |
| GET | `/tickets/summary` | `{mine, department, onHold, holdExpired, overdue}` |
| GET | `/tickets/options` | equipe ativa (com setores), setores e motivos de espera |
| GET | `/tickets/:id` | detalhe com linha do tempo |
| POST | `/tickets` | `{title, description?, priority?, departmentId?, responsibleId?, participantIds?, conversationId?, dueAt?}` — `tickets.create` |
| PATCH | `/tickets/:id` | `{title?, description?, priority?, dueAt?}` |
| POST | `/tickets/:id/comments` | `{body}` |
| POST | `/tickets/:id/status` | `{status: open\|in_progress\|resolved\|canceled, note?}` |
| POST | `/tickets/:id/hold` · `/resume` | `{reasonId, note?, until?}` · `{note?}` |
| POST | `/tickets/:id/transfer` | `{departmentId?, responsibleId?, keepMe?, note?}` |
| POST / DELETE | `/tickets/:id/participants[/:userId]` | `{userId, role?}` / tirar (sair de si mesmo sempre pode) |
| POST / PATCH / DELETE | `/tickets/hold-reasons[/:id]` | motivos de espera — `tickets.manage` |

## Limites desta versão

Sem anexos nos comentários e sem retomada automática na data. O ticket se liga a um atendimento quando aberto com a conversa aberta no painel (caixa no formulário).

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
| Tipo | opcional: [tipo da empresa](#tipos-de-ticket) com campos próprios (unidade, produto, paciente…) |
| Origem | painel, conversa, fluxo automático ou agente de IA (`source`) |
| Atendimento | opcional: a conversa de onde nasceu, a mensagem de origem e o retrato do contexto (ver [Aberto de uma conversa](#aberto-de-uma-conversa)) |

**Situação** (`TICKET_STATUSES`): Aberto (ninguém responsável) → Em andamento (tem responsável) → **Em espera** (congelado) → Resolvido / Cancelado. Reabrir volta para em andamento (com responsável) ou aberto.

## Aberto de uma conversa

O atendente abre o ticket **sem sair da conversa**, e o vínculo fica dos dois lados:

| Onde | O que |
|---|---|
| Topo da conversa | botão **Ticket**: abre o formulário já ligado à conversa (o momento = a última mensagem) |
| Cada mensagem (ao passar o mouse) | ícone de ticket, **Abrir ticket a partir desta mensagem**: ela vira o momento |
| Na conversa, depois | **marco** "Conversa virou ticket" no ponto em que foi aberto (nota interna, só a equipe vê), com *Ver ticket #N* e *Ver mensagem de origem*; selo **#N · situação** na mensagem de origem; selos dos tickets ativos no topo da conversa |
| Quando o ticket muda | resolvido, cancelado ou reaberto viram outro marco na conversa, com quem fez e a observação |
| No ticket | **Contexto da conversa**: as últimas 12 mensagens até o momento (`TICKET_CONTEXT_SIZE`), com a de origem destacada, e **Ver na conversa**, que abre a conversa já rolada até a mensagem (carrega o histórico antigo se precisar) |

O contexto é um **retrato gravado na abertura** (`tickets.context`): continua no ticket se a conversa for apagada ou o histórico limpo, e quem atende o ticket em outro setor lê o trecho mesmo sem acesso à conversa. O link *Ver na conversa* só aparece para quem pode abrir a conversa (número e setor). Para abrir de uma conversa, a pessoa precisa poder vê-la; a API recusa conversa de número ou setor que ela não atende.

Os marcos são notas internas com `content.kind = 'ticket'` (`MessageContent` do shared): nunca vão ao WhatsApp nem contam no uso. Falhar ao gravar o marco não derruba o ticket.

## Tipos de ticket

O ticket é genérico: cada empresa cadastra os **tipos** do seu negócio em **Tickets → Tipos**
(`tickets.manage`). Cada tipo tem cor, **setor, prioridade e prazo padrão** (dias) e até 15
**campos** (texto curto/longo, número, data, lista de opções, telefone; obrigatório ou não).
Tabela `ticket_types`; o ticket guarda `typeId` e os valores em `fields` (`{chave: valor}`) — o
valor continua no ticket mesmo se o campo sair do tipo depois.

**Modelos por nicho** (`TICKET_TYPE_PRESETS`, `packages/shared/src/tickets.ts`): Condomínio/portaria
(Manutenção, Reserva de área, Encomenda, Ocorrência), Farmácia (Encomenda de produto, Entrega,
Troca), Clínica (Retorno, Resultado de exame, Autorização de convênio), Serviços/assistência (Ordem
de serviço, Orçamento, Garantia) e Genérico. Importar adiciona os do nicho (nome repetido é
pulado); depois a empresa edita.

- **Chave do campo**: gerada do rótulo, sem acento (`Nº do apartamento` → `n_do_apartamento`) e
  estável — renomear o rótulo não quebra o fluxo que preenche a chave.
- **Validação** (`checkTicketValues`): obrigatório vazio e valor fora do esperado (opção que não
  existe, número/data inválidos) barram no painel; lista de opções aceita sem acento/maiúscula e
  grava a opção cadastrada.
- No formulário, escolher o tipo traz setor/prioridade/prazo e mostra os campos; no detalhe, os
  valores aparecem acima da descrição. Lista: selo do tipo e filtros por tipo e por origem.
- Apagar tipo usado só desativa (some do formulário e do fluxo; tickets antigos continuam com ele).

## Pelo fluxo

Ação **Abrir ticket** no bloco Ação (`create_ticket`): tipo, título, detalhes e campos com
{{variáveis}} do fluxo; setor, prioridade, responsável e prazo (vazios = os do tipo). O número vai
para `{{ticket}}` (ou a variável escolhida) para o fluxo responder o protocolo ao contato.

- `TicketsService.createSystem`: confere só o plano (`tickets`); sem pessoa por trás, `createdById`
  nulo, `source = flow` e a linha do tempo mostra "Fluxo “Nome”". Liga à conversa com o retrato
  das últimas mensagens e o marco "🎫 Ticket #N aberto pelo fluxo “Nome”".
- **Nunca para o fluxo**: campo obrigatório vazio, opção fora da lista, setor/responsável/tipo que
  não existe mais → abre mesmo assim e manda nota à equipe (`warnTeam`); fora do plano ou erro → não
  abre, `{{ticket}}` fica vazio e a equipe recebe a nota.
- Exemplo (portaria): "1 - Manutenção" → pergunta Bloco, Unidade e o problema → Abrir ticket
  (tipo Manutenção) → "Registramos sua solicitação, protocolo #{{ticket}}".

## No painel

- **Aviso na hora**: com responsável, ele (e participantes); sem responsável, **todos do setor**;
  da automação sem setor nem responsável, administradores e gerentes. Toast + som (`ticket_alert`).
- **Contador no menu** (item Tickets): abertos **sem responsável** nos setores que a pessoa atende
  (`summary.toPick`; gestão vê todos) — "alguém precisa pegar".
- Faixa no topo da tela de Tickets: "N sem responsável esperando alguém pegar" (abre o filtro).

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
| GET | `/tickets/summary` | `{mine, department, onHold, holdExpired, overdue, toPick}` |
| GET | `/tickets/types` | tipos da empresa (`TicketType[]`, também em `/tickets/options`) |
| POST / PATCH / DELETE | `/tickets/types[/:id]` | `{name, color, departmentId, priority, dueDays, fields, isActive}` — `tickets.manage`; apagar usado = desativar |
| GET / POST | `/tickets/types/export` · `/tickets/types/import` | formato portável (`{bundle}` / `{portable}`); importar cria os que faltam pelo nome — `tickets.manage`. Cabe no [modelo de perfil](20-modelos-de-perfil.md) |
| POST | `/tickets/types/preset` | `{niche}` importa os tipos do modelo — `tickets.manage` |
| GET | `/tickets/options` | equipe ativa (com setores), setores e motivos de espera |
| GET | `/tickets/:id` | detalhe com linha do tempo, `messageId`, `context` e `conversation.canOpen` |
| GET | `/tickets/conversation/:conversationId` | tickets que nasceram da conversa e que a pessoa enxerga (`{id, number, title, status, messageId, createdAt}`) |
| POST | `/tickets` | `{title, description?, priority?, departmentId?, responsibleId?, participantIds?, conversationId?, messageId?, dueAt?, typeId?, fields?}`: com `conversationId`, grava o retrato e o marco na conversa; `messageId` (da mesma conversa) marca o momento — `tickets.create` |
| PATCH | `/tickets/:id` | `{title?, description?, priority?, dueAt?}` |
| POST | `/tickets/:id/comments` | `{body}` |
| POST | `/tickets/:id/status` | `{status: open\|in_progress\|resolved\|canceled, note?}` |
| POST | `/tickets/:id/hold` · `/resume` | `{reasonId, note?, until?}` · `{note?}` |
| POST | `/tickets/:id/transfer` | `{departmentId?, responsibleId?, keepMe?, note?}` |
| POST / DELETE | `/tickets/:id/participants[/:userId]` | `{userId, role?}` / tirar (sair de si mesmo sempre pode) |
| POST / PATCH / DELETE | `/tickets/hold-reasons[/:id]` | motivos de espera — `tickets.manage` |

## Limites desta versão

Sem anexos nos comentários e sem retomada automática na data. O ticket se liga a uma conversa quando aberto de dentro dela (botão ou mensagem) ou, pela tela de Tickets, com a conversa aberta no painel (caixa no formulário). Não dá para ligar um ticket já aberto a uma conversa depois. O selo do topo mostra até 2 tickets (os ativos primeiro). Os campos do tipo não são editáveis no detalhe pela tela (a API aceita `fields` no PATCH). O agente de IA ainda não abre ticket (`source = agent` já existe para isso).

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
(Manutenção, Reserva de área, Encomenda, Ocorrência), Administradora de condomínios (2ª via de
boleto, Solicitação administrativa, Orçamento de prestador, Manutenção — campo Condomínio em todos),
Escritório jurídico (Consulta inicial, Andamento de processo, Envio de documentos, Prazo/audiência —
com Número do processo), Farmácia (Encomenda de produto, Entrega,
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
- **Contador no menu** (item Tickets): **não lidos**, como nas conversas — ver [Não lidos](#não-lidos).
  O "alguém precisa pegar" (`summary.toPick`, abertos sem responsável nos setores da pessoa) ficou na
  faixa do topo da tela de Tickets.
- **Filas prontas** (abas com contagem do `summary`): Comigo, Do meu setor, Sem responsável
  (`scope=to_pick`), Atrasados (`due=overdue`), Vencem hoje (`due=today`), Que abri, Todos.
- **Lista ou quadro** (preferência guardada no navegador). Lista: ordenar por última mudança,
  prazo, prioridade (urgente primeiro) ou mais novos; filtro por responsável; selos "atrasado Nd" /
  "vence hoje"; botão **Pegar** (vira responsável) no que está sem ninguém.
- **Quadro**: colunas Aberto, Em andamento, Em espera, Resolvido (até 50 por coluna, mesmos
  filtros; cancelado fica só na lista). Arrastar muda a situação; para Em espera pede o motivo;
  sair da espera é "retomar"; para Resolvido abre a conclusão (e o aviso ao reclamante).
- **Ações em massa** (seleção na lista): atribuir (para mim / ninguém / pessoa), situação,
  prioridade, congelar. `POST /tickets/bulk` aplica ticket a ticket a regra do individual e devolve
  os que não deram (`failed`, com o motivo).
- **Editar** no detalhe: título, descrição, prioridade, prazo e campos do tipo.

## Relatório

`/relatorios/tickets` (`GET /tickets/reports`, para quem tem `reports.view`, `tickets.view_all` ou
`tickets.manage`). Calculado na hora a partir das datas do ticket e da linha do tempo
(`tickets/tickets-report.ts`, função pura com teste) — sem tabela própria.

- **Período**: abertos (`createdAt`), resolvidos (`resolvedAt`) e cancelados (evento de status)
  dentro dele. **Agora**: pendentes, atrasados (aberto/em andamento com prazo vencido), sem
  responsável, em espera.
- **1ª resposta**: da abertura até a primeira ação (comentário, status, espera, transferência,
  incluir pessoa) de alguém que **não é quem abriu** (aberto pela automação: qualquer pessoa).
- **Resolução**: abertura → resolvido; **sem a espera** desconta o tempo parado em espera até
  resolver. Mostrado como mediana (o típico; um ticket esquecido não distorce) e média.
- **No prazo**: dos resolvidos no período que tinham prazo, quantos terminaram até ele.
- Série diária (fuso do cliente) abertos × resolvidos; quebra por responsável (o atual; resolvido
  sem responsável conta para quem resolveu), setor, tipo, prioridade e origem; espera por motivo
  (esperas iniciadas no período, tempo total e médio).
- Teto de 20 mil tickets e 1 ano por consulta.

## Reclamante

O contato que pediu (`tickets.requesterContactId`). Aberto de uma conversa (botão, mensagem ou
"ligar ao atendimento"), é o contato dela — dá para escolher outra pessoa; pela tela de Tickets,
escolhe-se nos contatos que a pessoa enxerga. Dá para vincular, trocar ou tirar depois, no detalhe.

**Aviso no WhatsApp** (`notifyRequester`, padrão ligado, desligável por ticket):

- **Abertura** — modelo `tenant_settings.ticketOpenedMessage`. Só para o aberto por pessoa
  (painel/conversa): o do fluxo ou do agente de IA não avisa (a própria automação responde).
- **Encerramento** (resolver ou cancelar) — modelo `ticketClosedMessage`. A tela mostra a
  mensagem pronta para revisar e editar; `{{conclusao}}` é o "o que foi feito" (ou o motivo do
  cancelamento). Na ação em massa e na API sem `message`, sai o modelo como está.
- Variáveis: `{{nome}} {{numero}} {{titulo}} {{tipo}} {{setor}} {{situacao}} {{conclusao}}`
  (`renderTicketNotice` no shared: linha com variáveis todas vazias some). Modelo nulo = texto
  padrão (`DEFAULT_TICKET_*_MESSAGE`). Edição em Tickets → **Avisos** (`tickets.manage`).
- Sai pela conversa de origem quando ela é do reclamante, senão pela conversa dele
  (`sendToContact`), **sem reabrir** a conversa. Mesmas regras de todo envio automático:
  descadastro, sem WhatsApp, número desconectado, **janela de 24h da Meta** (sem template), cota.
  Se não sair, o ticket encerra igual e a linha do tempo registra o evento `notice` com o motivo
  (a tela avisa).
- Migração `20270219000000_ticket_requester` (aditiva): tickets antigos abertos de conversa
  ganham o contato dela como reclamante **com o aviso desligado** (sem aviso retroativo).

## Não lidos

Ticket novo ou com novidade acende o menu como mensagem nova (pedido de 11/11/2026). Antes o número só
contava os abertos sem responsável: ticket atribuído direto a mim, comentário ou transferência não
sinalizava nada.

- **Me diz respeito** (`paraMim`): sou responsável ou participante, ou está aberto sem responsável num
  setor que eu atendo (gestão com `tickets.manage`: qualquer setor). Ticket que só vejo por `view_all`
  não conta.
- **Não lido**: ativo (aberto, em andamento, em espera), me diz respeito e `updatedAt` é depois da minha
  última abertura (`ticket_reads.seenAt`) — ou nunca abri. Comentário, transferência, mudança de
  situação etc. mexem no `updatedAt`.
- **Lido**: abrir o detalhe (`GET /tickets/:id`) grava agora. Toda escrita devolve o ticket por esse
  mesmo caminho, então quem fez a mudança não fica com ela "não lida".
- `GET /tickets/summary` devolve `unread` (até 500 candidatos); `GET /tickets` marca `unread` em cada
  linha (ponto + título em negrito na lista). O menu atualiza ao vivo pelo socket `ticket`.
- Migration `20270211000000_ticket_reads`: quem já participava dos tickets existentes começa com tudo
  lido, para o deploy não acender o menu de todo mundo com o passado.

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
| GET | `/tickets?scope=mine\|department\|created\|to_pick\|all&status=active\|<status>&due=overdue\|today&responsibleId=<id>\|none&sort=updated\|due\|priority\|created&priority=&departmentId=\|none&search=&page=&pageSize=` | lista (50 por página; `pageSize` 10–200) |
| GET | `/tickets/summary` | `{mine, department, onHold, holdExpired, overdue, toPick, dueToday, unread}` |
| POST | `/tickets/bulk` | `{ids (até 100), action: assign\|status\|priority\|hold, responsibleId?, status?, priority?, reasonId?, until?, note?}` → `{ok, failed: [{id, number, error}]}` |
| GET | `/tickets/reports?startDate=&endDate=&departmentId=&typeId=` | [relatório](#relatório) — `reports.view` ou `tickets.view_all` ou `tickets.manage` |
| PATCH | `/tickets/notice-templates` | `{openedMessage?, closedMessage?}` (null = padrão) — `tickets.manage`; devolve as opções |
| GET | `/tickets/types` | tipos da empresa (`TicketType[]`, também em `/tickets/options`) |
| POST / PATCH / DELETE | `/tickets/types[/:id]` | `{name, color, departmentId, priority, dueDays, fields, isActive}` — `tickets.manage`; apagar usado = desativar |
| GET / POST | `/tickets/types/export` · `/tickets/types/import` | formato portável (`{bundle}` / `{portable}`); importar cria os que faltam pelo nome — `tickets.manage`. Cabe no [modelo de perfil](20-modelos-de-perfil.md) |
| POST | `/tickets/types/preset` | `{niche}` importa os tipos do modelo — `tickets.manage` |
| GET | `/tickets/options` | equipe ativa (com setores), setores, motivos de espera, tipos e `notices` (modelos do aviso ao reclamante) |
| GET | `/tickets/:id` | detalhe com linha do tempo, `messageId`, `context` e `conversation.canOpen` |
| GET | `/tickets/conversation/:conversationId` | tickets que nasceram da conversa e que a pessoa enxerga (`{id, number, title, status, messageId, createdAt}`) |
| POST | `/tickets` | `{title, description?, priority?, departmentId?, responsibleId?, participantIds?, conversationId?, messageId?, dueAt?, typeId?, fields?}`: com `conversationId`, grava o retrato e o marco na conversa; `messageId` (da mesma conversa) marca o momento; `requesterContactId?` (sem ele, o contato da conversa), `notifyRequester?` — `tickets.create` |
| PATCH | `/tickets/:id` | `{title?, description?, priority?, dueAt?, fields?, requesterContactId? (null tira), notifyRequester?}` |
| POST | `/tickets/:id/comments` | `{body}` |
| POST | `/tickets/:id/status` | `{status: open\|in_progress\|resolved\|canceled, note?, notify?, message?}` — resolver/cancelar com reclamante avisa (ver [Reclamante](#reclamante)) |
| POST | `/tickets/:id/hold` · `/resume` | `{reasonId, note?, until?}` · `{note?}` |
| POST | `/tickets/:id/transfer` | `{departmentId?, responsibleId?, keepMe?, note?}` |
| POST / DELETE | `/tickets/:id/participants[/:userId]` | `{userId, role?}` / tirar (sair de si mesmo sempre pode) |
| POST / PATCH / DELETE | `/tickets/hold-reasons[/:id]` | motivos de espera — `tickets.manage` |

## Limites desta versão

Sem anexos nos comentários e sem retomada automática na data. O ticket se liga a uma conversa quando aberto de dentro dela (botão ou mensagem) ou, pela tela de Tickets, com a conversa aberta no painel (caixa no formulário). Não dá para ligar um ticket já aberto a uma conversa depois. O selo do topo mostra até 2 tickets (os ativos primeiro). O aviso ao reclamante não usa template da Meta: fora da janela de 24h (API oficial) ele não sai e fica registrado. O agente de IA ainda não abre ticket (`source = agent` já existe para isso).

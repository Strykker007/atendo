# Chat interno da equipe

Conversa direta ou em grupo entre membros do mesmo cliente, num widget flutuante que acompanha
a pessoa por todas as telas. Nada daqui vai ao WhatsApp: não passa pela fila de saída nem pelo
ledger de uso. O histórico é **permanente e auditável** — não existe apagar nem editar.

## Regras

| Regra | Onde |
|---|---|
| Conversa **direta**: uma só por par de pessoas (`directKey = "<menor id>:<maior id>"`, único por cliente). Abrir de novo devolve a mesma | `InternalChatController.create` |
| **Grupo**: nome obrigatório; quem cria entra junto. Membros só da equipe ativa do mesmo cliente | idem |
| Só membro lê e escreve (quem não é recebe 404 — nem sabe que a conversa existe) | `chatOf` |
| O dono do sistema "entrando como" o cliente não é da equipe: não vê nem cria conversas da equipe (403/404), mas pode auditar e fala pelo **canal de suporte** daquele cliente | `assertMember`, `chatOf` |
| Nome do autor gravado na mensagem (`authorName`): a auditoria continua legível depois que a pessoa sai da equipe (`authorId` vira null) | `internal_messages` |
| Não lidas por pessoa: `internal_chat_members.lastReadAt`. Escrever marca como lido até ali | `send` / `read` |
| Tempo real: `internal_message` e `internal_chat` vão **só para a sala de cada membro** (`user:<tenant>:<id>`), nunca para a sala do cliente | `ConversationsGateway.emitInternalMessage` |
| **Responder** (citação, como no WhatsApp): `replyToId` só de mensagem da mesma conversa; a mensagem vem com o trecho citado (`replyTo`). Citada que sumiu vira "Mensagem indisponível" | `send`, `MESSAGE_INCLUDE` |
| **Gerenciar grupo** (adicionar/tirar membros, renomear, apagar): quem criou o grupo ou quem tem `team.manage`. **Sair** do grupo: qualquer membro. O grupo nunca fica sem ninguém (apague-o) | `grupoGerenciavel` |
| Cada mudança no grupo vira um **aviso no histórico** (`system = true`, assinado por quem fez: "Ana adicionou Bruno") — é o registro de auditoria de quem mexeu | `aviso` |
| **Apagar grupo** = `deletedAt`/`deletedById`: some da lista e das rotas de todos os membros, mas **não sai do banco** — a auditoria continua lendo, marcado "apagado". Conversa direta não se apaga | `DELETE /internal-chat/chats/:id` |
| Quem é removido perde o acesso na hora (404) e o histórico anterior continua na auditoria | `removeMember` |
| "Online agora" = está com o painel aberto (sockets conectados, mesmo mecanismo do monitor do dono) | `GET /internal-chat/users` |

## Suporte

Canal direto entre o cliente e o **suporte do sistema** (o dono, `super_admin`), dentro do mesmo chat.

| Regra | Onde |
|---|---|
| **Um canal por cliente** (`isSupport = true`, `directKey = "support"`), criado na primeira vez que a equipe abre o chat ou que o dono puxa conversa | `ensureSupportChat` |
| Do lado do cliente, o canal é da **equipe inteira**: todo usuário ativo lê e escreve, sem cadastro de membro. Fica **fixado no topo** da lista, com o selo de headset. Não tem membros para gerenciar nem dá para apagar | `chats`, `chatOf` |
| Leitura (não lidas) por pessoa: linha em `internal_chat_members` criada sob demanda, dos dois lados | `readSupport` |
| Mensagem do dono sai marcada `fromSupport` (selo **Suporte** no balão) e assinada com o nome dele | `sendSupport` |
| Tempo real: mensagem do canal vai para a **sala do cliente** (`internal_message`) e para a sala **`owners`** (`support_message`), em qualquer tela dos dois lados | `ConversationsGateway.emitSupportMessage` |
| Resposta com citação funciona igual ao resto do chat. O canal aparece na auditoria do cliente como "Suporte" | — |

**Dono do sistema**: logado como ele mesmo, o widget aparece em modo **Suporte aos clientes**
(ícone de headset): aba **Conversas** (canais com mensagem, mais recentes primeiro, com não
lidas) e aba **Clientes** (busca; clicar abre ou cria o canal para puxar conversa).

**"Entrando como" um cliente**: o widget aparece como **Suporte a este cliente**, já aberto no canal
de suporte dele (sem lista, sem equipe, sem grupos). Usa as rotas `/internal-chat/*` com o token do
cliente: `GET /chats` devolve só o canal de suporte, `GET /users` devolve vazio, e o envio sai como
`fromSupport`, assinado com o nome do dono (`impersonatorId`) — igual a responder pelo modo Suporte.
A leitura (não lidas) é a mesma linha do dono nos dois modos.

### Fila de suporte

O canal de cada cliente é um só e **nunca some** — com muitos clientes, "todos os canais" vira uma
lista infinita onde quem espera se perde. Cada atendimento dentro do canal é um **ticket**
(`support_tickets`, numerado `#123`):

| Quando | O que acontece |
|---|---|
| Cliente escreve e não há ticket ativo | Abre um ticket `open` — entra na **Fila** |
| Suporte responde (ou clica **Assumir**) | `in_progress`, com responsável; primeira resposta grava `firstResponseAt` |
| Suporte puxa conversa sem ticket | Já nasce `in_progress` com quem escreveu |
| **Fila** (devolver) | Volta para `open`, sem responsável |
| **Encerrar** | `resolved` + aviso no histórico ("Atendimento #12 encerrado por Ana…"); a próxima mensagem do cliente abre outro |

No máximo um ticket ativo por canal (índice único parcial). Lógica em
`apps/api/src/modules/internal-chat/support-tickets.ts`, chamada pelo `sendSupport`.

Widget do dono, abas: **Fila** (ninguém assumiu, ordem de chegada, com o tempo de espera em
vermelho), **Meus**, **Ativos** (fila + em andamento de qualquer um), **Encerrados** (7 dias) e
**Clientes**. Dentro do canal, a faixa do topo mostra o ticket com **Assumir / Fila / Encerrar**.
Do lado do cliente, a mesma faixa diz "Atendimento #12 na fila — posição 3" ou "em andamento com
Ana". Entrando como o cliente, o dono vê o status, sem as ações. A migração
`20270104000000_support_tickets_number_sync` já põe na fila os canais com mensagem do cliente sem
resposta do suporte depois dela.

## Equipe do suporte

Os donos do sistema (`super_admin`, sem cliente) não são equipe de nenhum cliente, então não
cabem no chat interno acima — antes só se falavam abrindo um canal de suporte. O chat da equipe
do suporte é separado (tabelas `staff_*`, rotas `/super-admin/staff/*`):

| Regra | Onde |
|---|---|
| Canal fixo **Equipe do suporte** (`staff_chats.key = "team"`): todo `super_admin` ativo lê e escreve, sem cadastro — quem vira super_admin já entra, quem é desativado sai | `StaffChatController.chatOf` |
| Conversa **direta** entre dois do suporte: uma por par (`key = "<menor id>:<maior id>"`) | `POST /super-admin/staff/chats` |
| Não lidas por pessoa: `staff_chat_members.lastReadAt` (no canal da equipe a linha nasce sob demanda) | `send` / `read` |
| Tempo real: `staff_message` — canal da equipe vai para a sala `owners`; direta, só para `owner:<id>` de cada um | `ConversationsGateway.emitStaffMessage` |
| "Online agora" = super_admin com o painel aberto logado como ele mesmo | `ConversationsGateway.ownersOnline` |
| Sem grupos, sem apagar/editar, sem auditoria por cliente (não é dado de cliente) | — |

No widget do dono, o topo alterna **Clientes** (a fila de suporte) e **Equipe do suporte**
(canal da equipe fixado, conversas diretas e a lista de colegas com online). Não lidas da
equipe somam no selo do botão. "Entrando como" um cliente, o widget continua só no canal de
suporte daquele cliente.

## Auditoria

Permissão **`internal_chat.audit`** (grupo Gestão). Por padrão só o perfil **Administrador** tem —
a migração a acrescenta no perfil padrão Administrador não editado; gerente que precisa auditar
recebe por perfil. A tela **Configurações → Empresa → Auditoria do chat interno**
(`/configuracoes/chat-interno`) lista todas as conversas do cliente (filtro por pessoa) e mostra
o histórico completo. Ler pela auditoria não marca como lida para os membros.

## Widget

`components/layout/InternalChatWidget.tsx`, montado no shell autenticado (`app/(app)/layout.tsx`) —
por isso continua aberto e na mesma conversa ao trocar de página.

- Fechado: botão próprio (`Launcher`) — squircle com degradê da cor da marca, brilho de vidro e
  sombra colorida; desenho dos dois balões feito em SVG (`ChatGlyph`), com os três pontos de
  "digitando" animados quando há mensagem nova. Selo vermelho com pulso para não lidas e ponto
  verde quando há colega online. No hover, uma etiqueta desliza para dentro da tela com os rostos
  (iniciais) de quem está online e o total de novas. Animações respeitam "reduzir movimento".
  Arrasta pelo próprio botão; movimento abaixo
  de 5 px conta como clique (trackpad sempre mexe um pouco ao clicar — antes isso virava arrasto e
  o chat não abria).
- **Trava magnética**: ao soltar (botão, barra ou janela), o widget gruda na lateral mais próxima
  (esquerda/direita), na altura em que foi solto, com animação curta.
- **Sempre inteiro na tela**: a janela abre a partir da lateral travada — para cima quando o botão
  está na metade de baixo da tela, para baixo na metade de cima — e é limitada ao tamanho da tela
  (margem de 12 px). Redimensionar a janela do navegador reencaixa na hora.
- Aberto: abas **Conversas**, **Equipe** (online primeiro; clicar abre a conversa direta) e
  **Novo grupo** (marcar pessoas + nome). Arrasta pelo cabeçalho; minimiza para a barra — clicar em qualquer ponto da barra minimizada (sem arrastar) reabre.
- **Responder**: botão de seta ao passar o mouse no balão (ou duplo clique). A citação aparece
  acima do campo (Esc cancela); no balão, clicar na citação leva até a original.
- **Grupo**: a faixa de membros no topo da conversa ("Gerenciar") abre o painel do grupo — nome,
  membros (remover), adicionar pessoas, sair e apagar (com confirmação).
- Fica acima de modais e toasts (`z-[65]`); só os avisos do topo (`z-[70]`) passam por cima.
- Lateral, altura, aberto/minimizado e conversa aberta ficam no navegador (`localStorage`,
  `atendo-chat-interno`, versão 1 — a posição livre antiga é descartada).
- Som de mensagem nova do chat respeita o "som desligado" das conversas.

## Dados

- `internal_chats` — `{tenantId, isGroup, name, directKey, createdById, lastMessageAt, lastMessagePreview, deletedAt, deletedById, isSupport}`.
- `internal_chat_members` — `{chatId, userId, lastReadAt, joinedAt}`, chave `(chatId, userId)`.
- `internal_messages` — `{tenantId, chatId, authorId, authorName, text, replyToId, system, fromSupport, createdAt}`, índices `(chatId, createdAt)` e `(tenantId, createdAt)`.

Equipe do suporte: `staff_chats` — `{key (único), lastMessageAt, lastMessagePreview}`;
`staff_chat_members` — `{chatId, userId, lastReadAt}`; `staff_messages` — `{chatId, authorId,
authorName, text, replyToId, createdAt}`.

Migrações: `20261230000000_ignored_contacts_internal_chat`, `20261231000000_internal_chat_groups` (resposta, avisos, grupo apagado), `20270101000000_support_channel` (canal de suporte), `20270104000000_support_tickets_number_sync` (fila de suporte), `20270107000000_staff_chat` (equipe do suporte).

## API

| Método | Rota | Permissão | O quê |
|---|---|---|---|
| GET | `/internal-chat/users` | logado | Equipe ativa (menos você), com `online` |
| GET | `/internal-chat/chats` | logado | Suas conversas, mais recentes primeiro, com `unread` |
| POST | `/internal-chat/chats` | membro da equipe | `{userIds, name?}` — um id sem nome = direta (reaproveita); senão grupo |
| GET | `/internal-chat/chats/:id/messages?before=` | membro | 50 mensagens anteriores a `before` (ISO), em ordem cronológica |
| POST | `/internal-chat/chats/:id/messages` | membro | `{text, replyToId?}` (até 4000) |
| POST | `/internal-chat/chats/:id/members` | quem criou / `team.manage` | `{userIds}` — adiciona ao grupo |
| DELETE | `/internal-chat/chats/:id/members/:userId` | quem criou / `team.manage`; a própria pessoa = sair | Tira do grupo |
| PATCH | `/internal-chat/chats/:id` | quem criou / `team.manage` | `{name}` — renomeia |
| DELETE | `/internal-chat/chats/:id` | quem criou / `team.manage` | Apaga o grupo (some para os membros; fica na auditoria) |
| POST | `/internal-chat/chats/:id/read` | membro | Marca como lida |
| GET | `/super-admin/support/tenants` | super_admin | Clientes para puxar conversa |
| GET | `/super-admin/support/chats?view=` | super_admin | `queue` (fila, ordem de chegada), `mine`, `active`, `resolved` (7 dias) ou `all` (padrão: todo canal com mensagem). Cada item com `unread` e `ticket` |
| GET | `/super-admin/support/counts` | super_admin | `{queue, mine, active}` — badges das abas |
| POST | `/super-admin/support/tickets/:id/assign` | super_admin | Assumir (também puxa de outro do suporte) |
| POST | `/super-admin/support/tickets/:id/release` | super_admin | Devolver para a fila |
| POST | `/super-admin/support/tickets/:id/resolve` | super_admin | Encerrar (aviso no histórico do cliente) |
| POST | `/super-admin/support/tenants/:tenantId/chat` | super_admin | Abre (ou cria) o canal do cliente |
| GET | `/super-admin/support/chats/:id/messages?before=` | super_admin | Histórico do canal |
| POST | `/super-admin/support/chats/:id/messages` | super_admin | `{text, replyToId?}` — sai como `fromSupport` |
| POST | `/super-admin/support/chats/:id/read` | super_admin | Marca como lido |
| GET | `/super-admin/staff/users` | super_admin | Colegas do suporte (menos você), com `online` |
| GET | `/super-admin/staff/chats` | super_admin | Canal da equipe (primeiro) + suas diretas, com `unread` (`isStaff: true`; canal = `isGroup`) |
| POST | `/super-admin/staff/chats` | super_admin | `{userId}` — abre (ou reaproveita) a direta |
| GET | `/super-admin/staff/chats/:id/messages?before=` | super_admin | Histórico |
| POST | `/super-admin/staff/chats/:id/messages` | super_admin | `{text, replyToId?}` |
| POST | `/super-admin/staff/chats/:id/read` | super_admin | Marca como lido |
| GET | `/internal-chat/audit/chats?userId=` | `internal_chat.audit` | Todas as conversas do cliente, com contagem de mensagens |
| GET | `/internal-chat/audit/chats/:id/messages?before=` | `internal_chat.audit` | Histórico de qualquer conversa do cliente |

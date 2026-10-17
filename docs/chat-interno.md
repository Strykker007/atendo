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
| O dono do sistema "entrando como" o cliente não é da equipe: não usa o chat (403), mas pode auditar | `assertMember` |
| Nome do autor gravado na mensagem (`authorName`): a auditoria continua legível depois que a pessoa sai da equipe (`authorId` vira null) | `internal_messages` |
| Não lidas por pessoa: `internal_chat_members.lastReadAt`. Escrever marca como lido até ali | `send` / `read` |
| Tempo real: `internal_message` e `internal_chat` vão **só para a sala de cada membro** (`user:<tenant>:<id>`), nunca para a sala do cliente | `ConversationsGateway.emitInternalMessage` |
| **Responder** (citação, como no WhatsApp): `replyToId` só de mensagem da mesma conversa; a mensagem vem com o trecho citado (`replyTo`). Citada que sumiu vira "Mensagem indisponível" | `send`, `MESSAGE_INCLUDE` |
| **Gerenciar grupo** (adicionar/tirar membros, renomear, apagar): quem criou o grupo ou quem tem `team.manage`. **Sair** do grupo: qualquer membro. O grupo nunca fica sem ninguém (apague-o) | `grupoGerenciavel` |
| Cada mudança no grupo vira um **aviso no histórico** (`system = true`, assinado por quem fez: "Ana adicionou Bruno") — é o registro de auditoria de quem mexeu | `aviso` |
| **Apagar grupo** = `deletedAt`/`deletedById`: some da lista e das rotas de todos os membros, mas **não sai do banco** — a auditoria continua lendo, marcado "apagado". Conversa direta não se apaga | `DELETE /internal-chat/chats/:id` |
| Quem é removido perde o acesso na hora (404) e o histórico anterior continua na auditoria | `removeMember` |
| "Online agora" = está com o painel aberto (sockets conectados, mesmo mecanismo do monitor do dono) | `GET /internal-chat/users` |

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
  **Novo grupo** (marcar pessoas + nome). Arrasta pelo cabeçalho; minimiza para a barra.
- **Responder**: botão de seta ao passar o mouse no balão (ou duplo clique). A citação aparece
  acima do campo (Esc cancela); no balão, clicar na citação leva até a original.
- **Grupo**: a faixa de membros no topo da conversa ("Gerenciar") abre o painel do grupo — nome,
  membros (remover), adicionar pessoas, sair e apagar (com confirmação).
- Fica acima de modais e toasts (`z-[65]`); só os avisos do topo (`z-[70]`) passam por cima.
- Lateral, altura, aberto/minimizado e conversa aberta ficam no navegador (`localStorage`,
  `atendo-chat-interno`, versão 1 — a posição livre antiga é descartada).
- Som de mensagem nova do chat respeita o "som desligado" das conversas.

## Dados

- `internal_chats` — `{tenantId, isGroup, name, directKey, createdById, lastMessageAt, lastMessagePreview, deletedAt, deletedById}`.
- `internal_chat_members` — `{chatId, userId, lastReadAt, joinedAt}`, chave `(chatId, userId)`.
- `internal_messages` — `{tenantId, chatId, authorId, authorName, text, replyToId, system, createdAt}`, índices `(chatId, createdAt)` e `(tenantId, createdAt)`.

Migrações: `20261230000000_ignored_contacts_internal_chat`, `20261231000000_internal_chat_groups` (resposta, avisos, grupo apagado).

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
| GET | `/internal-chat/audit/chats?userId=` | `internal_chat.audit` | Todas as conversas do cliente, com contagem de mensagens |
| GET | `/internal-chat/audit/chats/:id/messages?before=` | `internal_chat.audit` | Histórico de qualquer conversa do cliente |

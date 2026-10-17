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

- Fechado: botão redondo com o total de não lidas. Arrasta pelo próprio botão.
- Aberto: abas **Conversas**, **Equipe** (online primeiro; clicar abre a conversa direta) e
  **Novo grupo** (marcar pessoas + nome). Arrasta pelo cabeçalho; minimiza para a barra.
- Posição, aberto/minimizado e conversa aberta ficam no navegador (`localStorage`, `atendo-chat-interno`).
- Som de mensagem nova do chat respeita o "som desligado" das conversas.

## Dados

- `internal_chats` — `{tenantId, isGroup, name, directKey, createdById, lastMessageAt, lastMessagePreview}`.
- `internal_chat_members` — `{chatId, userId, lastReadAt, joinedAt}`, chave `(chatId, userId)`.
- `internal_messages` — `{tenantId, chatId, authorId, authorName, text, createdAt}`, índices `(chatId, createdAt)` e `(tenantId, createdAt)`.

Migração: `20261230000000_ignored_contacts_internal_chat`.

## API

| Método | Rota | Permissão | O quê |
|---|---|---|---|
| GET | `/internal-chat/users` | logado | Equipe ativa (menos você), com `online` |
| GET | `/internal-chat/chats` | logado | Suas conversas, mais recentes primeiro, com `unread` |
| POST | `/internal-chat/chats` | membro da equipe | `{userIds, name?}` — um id sem nome = direta (reaproveita); senão grupo |
| GET | `/internal-chat/chats/:id/messages?before=` | membro | 50 mensagens anteriores a `before` (ISO), em ordem cronológica |
| POST | `/internal-chat/chats/:id/messages` | membro | `{text}` (até 4000) |
| POST | `/internal-chat/chats/:id/read` | membro | Marca como lida |
| GET | `/internal-chat/audit/chats?userId=` | `internal_chat.audit` | Todas as conversas do cliente, com contagem de mensagens |
| GET | `/internal-chat/audit/chats/:id/messages?before=` | `internal_chat.audit` | Histórico de qualquer conversa do cliente |

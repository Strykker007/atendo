# Apagar mensagem e limpar histórico

Apagar no painel **nunca apaga do banco**. A linha da mensagem é o ledger de uso (`MessageUsage`)
e o registro do que foi dito: o conteúdo original fica guardado, some da tela de todo mundo e,
no lugar, aparece *"Mensagem apagada por [nome] em [data/hora]"*. Só quem tem
`conversations.view_deleted` abre o original.

## Quem pode apagar

| Permissão | Concede | Padrão |
|---|---|---|
| — (qualquer pessoa) | apagar a **própria** mensagem enviada (ou nota) com menos de 2 dias | todos |
| `conversations.delete_message` | apagar qualquer uma: de colegas, da automação, recebidas e antigas | Gerente, Administrador |
| `conversations.delete_chat` | limpar o histórico inteiro da conversa | Gerente, Administrador |
| `conversations.view_deleted` | ver o conteúdo original de mensagens apagadas | Gerente, Administrador |

O padrão "a própria qualquer um apaga, a dos outros exige permissão" é o mesmo de
`conversations.transfer_any`. A janela da própria (`OWN_MESSAGE_DELETE_WINDOW_MS`, no shared) é
a mesma do "apagar para todos" do WhatsApp (`MESSAGE_REVOKE_WINDOW_MS`, 48h): depois disso nem o
WhatsApp apaga, e esconder do histórico vira decisão de gerente.

A migration `message_delete` acrescenta as três permissões aos perfis padrão **Gerente** e
**Administrador** não editados (`customized = false`); perfil editado pelo cliente fica como está.
Todas as rotas `/conversations/:id/…` continuam passando pelo `ConversationScopeGuard` (número e
departamento).

## O que acontece ao apagar uma mensagem

`ConversationsService.deletionPlan` decide, o controller fala com o provider (como na reação),
`markDeleted` grava:

| Mensagem | Resultado |
|---|---|
| Enviada, entregue, < 2 dias, número conectado, **Evolution** | "apagar para todos" (`DELETE /chat/deleteMessageForEveryone`) → `deletedForEveryone = true` |
| Enviada pela **Meta** | só no painel — a Cloud API não tem operação de apagar. Aviso na tela |
| Enviada há mais de 2 dias / número desconectado / provider recusou | só no painel, com aviso explicando o motivo |
| Ainda na fila (`pending`) | envio **cancelado** (`failed` + "Envio cancelado…") e a próxima da conversa é promovida. Se o worker já tinha entregue, vira "apagada só no painel" com aviso |
| Com falha (nunca chegou) | só no painel, sem aviso |
| Recebida do contato | só no painel (não existe apagar a mensagem do outro). Aviso |
| Nota interna | só no painel |

Falha do provider **nunca** impede de apagar no painel: o atendente recebe o motivo como aviso
(`notice` na resposta → toast amarelo).

Junto com a exclusão:
- evento `message_deleted` em `conversation_events` (quem, quando, o que e onde — **nunca o
  conteúdo**, porque o histórico do atendimento é aberto a quem vê a conversa);
- `lastMessagePreview` vira "🚫 Mensagem apagada" se era a última;
- o cache do resumo da IA é descartado e mensagens apagadas não entram mais no contexto da IA;
- apagada não pode ser encaminhada, reagida nem reenviada.

## Limpar histórico

`DELETE /conversations/:id/messages` marca todas as mensagens como apagadas **só no painel** —
pedir ao provider uma a uma seria uma rajada de chamadas no número (risco de bloqueio). O que
estava na fila é cancelado. A conversa continua existindo (é a linha do tempo com a pessoa): se o
contato escrever, segue normalmente. Registra `history_cleared` com a contagem.

## Redação (`present()`)

Mensagem com `deletedAt` sai da API — HTTP **e** socket — sem `text`, mídia, `content`, reações,
citação e erro. O socket vai para a sala do tenant inteiro, por isso o corte é no `present()` e
não na tela. Citação de uma apagada mostra "🚫 Mensagem apagada". O original só sai por
`GET /conversations/:id/messages/:messageId/original` (`conversations.view_deleted`), com a mídia
em URL assinada temporária. O arquivo continua no storage.

## Tempo real

| Evento | Quando | Efeito no painel |
|---|---|---|
| `message` | mensagem apagada (já redigida) | a bolha vira o aviso de apagada em todas as telas abertas |
| `conversation` | prévia/resumo mudaram | card da lista e Kanban atualizam |
| `messages_cleared` `{ conversationId }` | histórico limpo | a conversa recarrega |

## Dados

`messages.deletedAt`, `deletedById` (sem FK, de propósito), `deletedByName` (o nome sobrevive à
remoção do usuário), `deletedForEveryone`. Enum `ConversationEventType` ganhou `message_deleted`
e `history_cleared`.

## Limites conhecidos

- Corrida rara: se o worker estiver entregando a mensagem no exato instante do cancelamento, ela
  chega ao contato e fica marcada como apagada só no painel (sem aviso, porque a entrega termina
  depois da resposta).
- Mensagem que o **contato** apaga no celular dele ainda não é refletida no painel.
- Abrir o original não gera evento de auditoria (só log de requisição).

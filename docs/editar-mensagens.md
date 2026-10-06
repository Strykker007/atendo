# Editar mensagem enviada

O atendente corrige a **própria** mensagem de texto depois de enviada: no painel e no celular do
contato, que vê o texto novo marcado como *editada* (como no WhatsApp).

## Quem pode

| Permissão | Concede | Padrão |
|---|---|---|
| `conversations.edit_message` | editar as **próprias** mensagens de texto | Administrador, Gerente e Atendente |

Vem ligada nos três perfis padrão: ela existe para poder ser **retirada** de quem não deve editar
(*Equipe → Perfis de acesso*). Perfil que o cliente já tinha editado (`customized`) não ganha
sozinho — liga na mesma tela. Sem a permissão, o lápis some e a API responde 403.

Mensagem de colega, da automação, recebida ou nota interna **não** se edita (a nota se apaga e
escreve de novo).

## Regras

| Situação | O que acontece |
|---|---|
| Ainda na fila (`pending`) | Troca só no painel — o worker manda o texto novo. Se ela sair no meio do caminho, 409 "acabou de ser enviada" e a tela tenta de novo pelo provider |
| Enviada, número **Evolution**, até **15 min** (`MESSAGE_EDIT_WINDOW_MS`) | Edita no WhatsApp do contato (`POST /chat/updateMessage`) e **só grava se o provider aceitar** |
| Passou de 15 min | 409 — o WhatsApp não aceita mais |
| Número **Meta** (API oficial) | 422 — a Cloud API não tem edição. O lápis nem aparece |
| Falhou / sem `externalId` | 409 — apague e envie de novo |
| Mídia, template, botões/lista | 400 — só texto |
| Número desconectado | 422 |

Editar **só no painel** uma mensagem já entregue nunca acontece: o atendente veria um texto que
o contato não leu.

## Assinatura

Com a assinatura ligada, a mensagem começa com `*Nome:*`. O modal de edição mostra só o corpo e
devolve a mesma assinatura no texto novo — editar não "desassina".

## Auditoria

- `Message.editedAt` marca a bolha como **editada** (também quando a edição vem do celular, pelo
  webhook da Evolution — `InboundService.applyEdit`).
- Cada edição feita no painel grava o evento `message_edited` com `reason` = texto anterior
  (até 300 caracteres). Aparece no **Histórico** do atendimento: "Fulano editou uma mensagem".
- A prévia da lista acompanha se a editada era a última mensagem da conversa.

## API

`PATCH /conversations/:id/messages/:messageId` `{ text }` (1–4096) — exige
`conversations.edit_message`. Devolve a mensagem atualizada e emite `message` no socket.

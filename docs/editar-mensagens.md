# Editar mensagem enviada

Quem tem a permissão corrige uma mensagem de texto depois de enviada: no painel e no celular do
contato, que vê o texto novo marcado como *editada* (como no WhatsApp).

## Quem pode

| Permissão | Concede | Padrão |
|---|---|---|
| `conversations.edit_message` | editar **qualquer** mensagem de texto enviada pelo número | Administrador, Gerente e Atendente |

Vem ligada nos três perfis padrão: ela existe para poder ser **retirada** de quem não deve editar
(*Equipe → Perfis de acesso*). Perfil que o cliente já tinha editado (`customized`) não ganha
sozinho — liga na mesma tela. Sem a permissão, o lápis some e a API responde 403.

**Uma permissão só, qualquer origem**: a própria, a de um colega, a digitada no **celular** do
número (Evolution — o painel é mais um aparelho da conta, e o WhatsApp deixa editar o que saiu
dela) e a da automação. Não há posse da conversa nem permissão separada por origem: quem pode
editar, edita. O escopo de números/departamentos continua valendo (`ConversationScopeGuard`).

Não se edita: mensagem **recebida** (é do contato) e **nota interna** (apaga e escreve de novo).

## Regras

| Situação | O que acontece |
|---|---|
| Ainda na fila (`pending`) | Troca só no painel — o worker manda o texto novo (vale também na Meta). Se ela sair no meio do caminho, 409 "acabou de ser enviada" e a tela tenta de novo pelo provider |
| Enviada, número **Evolution**, até **15 min** (`MESSAGE_EDIT_WINDOW_MS`) | Edita no WhatsApp do contato (`POST /chat/updateMessage`) e **só grava se o provider aceitar** |
| Passou de 15 min | 409 — o WhatsApp não aceita mais |
| Número **Meta** (API oficial) | 422 — a Cloud API não tem edição. O lápis nem aparece |
| Falhou / sem `externalId` | 409 — apague e envie de novo |
| Mídia, template, botões/lista | 400 — só texto |
| Número desconectado | 422 |

Editar **só no painel** uma mensagem já entregue nunca acontece: o atendente veria um texto que
o contato não leu.

## Endereço da conversa (LID)

A Evolution confere a edição comparando o `remoteJid` que ela **gravou** para a mensagem com o
que pedimos — diferente, recusa com *"RemoteJid does not match"*. E o gravado nem sempre é o
telefone: o WhatsApp está migrando contatos para o **LID** (`242511201210535@lid`), e a mensagem
digitada no celular costuma ficar assim, enquanto a enviada pela API fica como
`<telefone>@s.whatsapp.net`; para celular BR ela ainda tira/põe o nono dígito ao montar o JID.
Por isso, antes de editar (e de apagar para todos), o provider consulta a própria Evolution
(`POST /chat/findMessages` pelo id) e usa o endereço gravado (`storedRemoteJid`); sem registro,
cai no telefone.

## Assinatura

Com a assinatura ligada, a mensagem começa com `*Nome:*`. O modal de edição mostra só o corpo e
devolve a mesma assinatura no texto novo — editar não "desassina".

## Auditoria

- `Message.editedAt` marca a bolha como **editada** (também quando a edição vem do celular, pelo
  webhook da Evolution — `InboundService.applyEdit`).
- Cada edição feita no painel grava o evento `message_edited` com quem editou (`actor`) e, no
  `reason`, a origem da mensagem (*própria*, *de Fulano*, *enviada pelo celular*, *da automação*)
  e o texto anterior (até 300 caracteres). Aparece no **Histórico** do atendimento: "Fulano editou uma mensagem".
- A prévia da lista acompanha se a editada era a última mensagem da conversa.

## API

`PATCH /conversations/:id/messages/:messageId` `{ text }` (1–4096), qualquer mensagem `out` de texto — exige
`conversations.edit_message`. Devolve a mensagem atualizada e emite `message` no socket.

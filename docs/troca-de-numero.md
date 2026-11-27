# Troca do número de envio (API oficial)

A conversa continua **uma só**; o que muda é o número por onde as próximas mensagens saem. Só
existe entre números da **API oficial (Meta)**: a conversa precisa estar enviando por um número
oficial e o destino também precisa ser oficial. QR Code (Evolution) não troca nem é afetado.

No celular do cliente, o número novo é outra conversa do WhatsApp. No painel, o atendente segue no
mesmo histórico, com um divisor onde o número mudou.

## Para o atendente

- No cabeçalho da conversa aparece **o nome do número de envio** (ícone de celular). Com a
  permissão e com outro número oficial conectado, ele abre a lista "Enviar por outro número"
  (o número em que a conversa nasceu aparece marcado como *original*).
- Ao confirmar, nada é enviado. Se o cliente não falou por aquele número nas últimas 24h (o comum),
  o composer mostra "Janela de 24h fechada" e o botão **Enviar template**, que usa os templates
  do número **novo**. Se ele já falou por lá nas últimas 24h, texto livre passa.
- Na linha do tempo, onde o número muda aparece "Daqui em diante pelo número X" (mensagem nossa) ou
  "O cliente escreveu pelo número X" (mensagem dele). Notas internas não contam.
- **O cliente responde por qualquer um dos números**: a mensagem entra nesta mesma conversa. A
  conversa passa a responder pelo número em que ele escreveu por último, porque é lá que a janela de
  24h está aberta. Se o canal mudou enquanto o atendente digitava, o envio volta com 409
  `number_changed` ("O canal desta conversa mudou para…") em vez de sair pelo número errado.
- O histórico (`HistorySheet`) registra cada troca: "Fulano trocou o número de envio — Loja Centro →
  Loja Shopping" ou "Número de envio trocado automaticamente — … (o contato escreveu por este número)".

## Quem pode

Permissão `conversations.switch_number`, que vem nos perfis padrão de **Administrador, Gerente e
Atendente** (a migration `conversation_channel` acrescenta ao Administrador de todo cliente e aos
Gerente/Atendente não editados). Além disso, valem as mesmas regras de responder:

- conversa **aberta** e **com dono**: sem dono, a API responde "Assuma o atendimento antes";
- é sua, ou o contato é isento, ou você tem `conversations.take_over` (assumir de outra pessoa).
  Trocar o número não assume a conversa; responder, sim;
- o número de destino é oficial, está ativo e conectado, e está no seu escopo de números;
- o contato **não** tem outro atendimento **aberto** naquele número, nem numa conversa própria nem
  noutra que envia por ele. Se tiver, a API responde 409 `channel_busy` com o `conversationId` dela.

Não é cobrado à parte. O que cada envio custa vai para o `UsageService` com o número por onde ele
saiu de fato.

## Relatórios

Trocar de número **não** abre um atendimento novo: é a mesma conversa e o mesmo atendimento.
Atendimento novo só existe se encerrar e o contato voltar, como sempre. Listas, filtros por
número, distribuição e escopo seguem o **número em que a conversa nasceu** (`numberId`). O uso
(`message_usage`) e o custo por número seguem o número de cada mensagem.

## Modelo

| Coluna (`conversations`) | O quê |
|---|---|
| `numberId` | número em que a conversa nasceu. Não muda; é a base de escopo, lista e `@@unique(numberId, contactId)` |
| `channelNumberId` | número de envio atual. Nulo = o próprio `numberId`; nunca é igual a ele. `@@unique(contactId, channelNumberId)`: um número é canal de no máximo uma conversa do contato |
| `channelHistory` | todos os números (fora o `numberId`) que já foram canal. Mensagem por qualquer um deles cai nesta conversa |
| `channelChangedAt` | preenchido = já trocou pelo menos uma vez. **Nulo = regra antiga intacta** (canal = `numberId`, janela = `lastInboundAt`) |
| `channelLastInboundAt` | última mensagem do contato pelo número de envio atual: a janela de 24h, que na Meta é por número |

`lastInboundAt` continua sendo a última mensagem do contato por **qualquer** número: lista,
relatórios e espera usam esse valor. A janela de envio sai de `channelLastInboundAt` quando
`channelChangedAt` está preenchido.

Cada mensagem guarda `numberId` (por onde passou). O worker já enviava pelo número da mensagem,
nunca pelo da conversa, e marca como lida só a recebida pelo mesmo número do envio.

Evento `channel_changed` em `conversation_events`, com `reason` = "A → B". Ator nulo = troca
automática porque o contato escreveu por outro número.

## Onde a regra está (`apps/api/src/modules/conversations/channel.ts`)

- `channelConversation(number, contactId)`: dado um número **oficial**, devolve a conversa do contato
  que envia por ele agora ou, depois, a que já enviou (a mais recente). `null` = siga com a
  conversa do próprio número. É usada na entrada da mensagem (ao vivo, eco do celular, ligação,
  recuperação de lacuna, importação), no "Nova conversa" (`start`), na transmissão, no lembrete e no
  `sendToPhone`. Para QR Code ela nem consulta.
- `lastInboundOn(conv, numberId)`: janela de um número específico. Soma as mensagens desta conversa
  por aquele número e a conversa própria do contato nele (o cliente pode ter escrito lá antes).
- `ConversationsService.comCanal(conv, via?)`: troca `numberId`/`number`/`lastInboundAt` pelos do
  canal (ou de `via`, quando o envio tem número próprio). Passam por ela: `send`, `sendAsSystem`
  (robô, avisos, IA), `sendToContact`, `assertFlowCanStart`, `resend`, `reactionTarget` (que usa o
  número **da mensagem** reagida), o template do composer e o agendamento.
- `switchChannel` (tela), `followInboundChannel` (entrada) e `aplicarCanal` (grava a troca com
  update otimista, o histórico, a janela e o evento; libera o número se ele era canal de outra
  conversa **encerrada** do contato).

Envios com número próprio não mudam o canal: a **transmissão** sai pelo número da campanha e o
**lembrete** sem conversa aberta, pelo número do sistema. O "Nova conversa" por um número que é
(ou foi) canal usa esta conversa e passa a enviar por ele.

## API

`POST /conversations/:id/channel` `{ numberId }`, com permissão `conversations.switch_number`.
Devolve a conversa como o `GET /conversations/:id`. Voltar ao número original é o mesmo
endpoint com o `numberId` dele. Erros: 400 (não é oficial, desconectado, encerrada, sem dono,
grupo), 403 (sem permissão, conversa de outra pessoa), 404 (número fora do escopo), 409
`channel_busy` ou troca concorrente.

`GET /conversations/:id` passou a devolver `number`/`numberId`/`lastInboundAt` do **número de
envio**, mais `homeNumber` (o número em que nasceu) e `channelChangedAt`. A lista
(`GET /conversations`) continua com o número em que a conversa nasceu.

## Limites conhecidos

- Número de envio excluído: a conversa continua apontando para ele até alguém trocar, e o envio
  diz que o número não é válido. A lista de troca oferece os números ativos, inclusive o original.
- O escopo de números é conferido na troca. Depois disso, quem atende a conversa (escopo pelo
  número de origem) envia pelo canal escolhido.
- Mensagem fora de ordem (mais antiga que a última recebida) entra no histórico mas não muda o canal.

## Compatibilidade e retorno

Migration `20270221000000_conversation_channel`, só aditiva: 4 colunas opcionais ou com padrão,
índice único parcial na prática (nulo não conflita), FK com `SET NULL` e o valor de enum
`channel_changed`. Conversa que nunca trocou não muda de comportamento. **Retorno para a versão
anterior da API depois que alguém já trocou de número:** o client antigo não conhece
`channel_changed` e o `GET /conversations/:id/events` dessas conversas daria erro. Mensagens que
chegarem pelo número novo voltariam a cair numa conversa própria daquele número. Antes de voltar,
rode `UPDATE conversations SET "channelNumberId" = NULL` e
`DELETE FROM conversation_events WHERE type = 'channel_changed'` (com backup).

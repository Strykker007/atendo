# Grupos restritos (opt-in estrito)

Grupos do WhatsApp entram no sistema como **destino de transmissão** e, com o recurso de plano
`groups_inbox`, como **conversa livre** no painel ([abaixo](#grupos-nas-conversas)) — sempre só os
que o admin marcou um a um. Grupo nenhum abre atendimento.

## Regras

| Regra | Onde |
|---|---|
| **Descarte imediato no webhook**: todo evento de grupo (`@g.us`) — mensagem, status, edição, presença, `groups.*`, `group-participants.update` — sai do corpo **antes de enfileirar**. Não vira job, não grava no banco, não gera log, não abre conversa. Lote misto segue só com as conversas. Exceção: mensagem, recibo e edição de grupo marcado **Conversas** (`inbox`) | `whatsapp/group-filter.ts` (`stripGroupEvents`), chamado em `WebhooksController.evolution` |
| Grupo **autorizado** para transmissão também é descartado na entrada: ele é só destino. A lista dos `inbox` vem de memória (`GroupInboxRegistry`, 1 min por instância, buscada só quando o corpo traz algo de grupo) — consultar o banco por mensagem de grupo seria o custo que o filtro evita. O histórico continua ignorando `@g.us` | `group-filter.ts`, `group-inbox.ts` |
| **Opt-in estrito**: grupo listado nasce `authorized = false`. Só entra em transmissão o marcado, do mesmo número da transmissão | `GroupsController`, `CampaignsService.create` |
| Ressincronizar não apaga grupo marcado (transmissão **ou** conversas), mesmo que o número tenha saído dele | `GroupsController.sync` |
| Desmarcado depois de criada a transmissão → o alvo falha com "Grupo não está mais autorizado" | `GroupSender.send` |
| Só QR Code (Evolution). A API oficial da Meta não envia para grupos | `GroupsController.sync`, `CampaignsService` |

## Tela

**Configurações → Empresa → Números de WhatsApp → Grupos autorizados** (`/configuracoes/grupos`).
Escolhe o número (só QR), **Buscar grupos do WhatsApp** (`POST /groups/sync`, número conectado)
e marca/desmarca cada grupo em duas colunas: **Transmissão** (`authorized`) e **Conversas**
(`inbox`, desabilitada sem o recurso `groups_inbox`). Ressincronizar preserva as marcações; grupo
de que o número saiu é removido se estava desmarcado nas duas (o marcado fica, para o admin ver e desmarcar). Gerir exige
`numbers.manage` e poder gerenciar aquele número (`canManageNumber`).

Na **Nova transmissão** (QR), a seção Público mostra os grupos autorizados do número como chips:
somam aos contatos.

## Envio (antiban)

Grupo não é contato nem tem conversa, então não passa pela fila de saída (que é por conversa).
`campaigns/group-sender.ts` reaplica as **mesmas travas**, na mesma ordem:

1. cota do plano (`UsageService.canSend`) e assinatura da empresa;
2. teto proativo do dia do número (`SendPacer.dailyStatus`) — conta no mesmo contador;
3. aquecimento da sessão (QR lido há < 72h: contatos novos por hora, cada grupo conta como um);
4. ritmo do número como envio automático (`SendPacer.reserve`: espaçamento e teto por hora);
5. "digitando…" pelo tempo do texto, como o automático da fila;
6. depois de entregue: contador do dia, ritmo pós-envio e **ledger** (`UsageService.record` com
   `messageId = null` — não há linha em `messages`).

O despachante da campanha (`campaign.processor.ts`) cuida do resto, igual aos contatos: **uma
mensagem por vez com 20–60 s sorteados**, horário de funcionamento, teto de transmissão por 24h
do número (contatos + grupos somam) e pausa automática com 3 falhas seguidas (contatos e grupos
na mesma linha do tempo). Grupos vão depois dos contatos. Quando uma trava pede para esperar, o
alvo continua pendente e a campanha volta à fila.

Variáveis: `{{saudacao}}`, `{{empresa}}` e as da empresa funcionam; `{{contact.*}}` sai vazio
(num grupo não há "primeiro nome" de quem lê).

Progresso: grupos contam em `stats` como enviados/falhas (sem entregue/lido — o status de
mensagem de grupo também é descartado no webhook). Falhas aparecem em `problemas` como
"Grupo <nome>".

## Dados

- `whatsapp_groups` — `{tenantId, numberId, jid ('…@g.us'), name, size, authorized, authorizedAt, authorizedById}`, único por `(numberId, jid)`.
- `campaign_group_targets` — alvo de grupo da transmissão: `{campaignId, groupId, status, externalId, error, sentAt}`, único por `(campaignId, groupId)`.

## API

| Método | Rota | Permissão | O quê |
|---|---|---|---|
| GET | `/groups?numberId=` | `numbers.manage` ou `campaigns.manage` | Grupos listados (dos números que a pessoa usa), autorizados primeiro |
| POST | `/groups/sync` | `numbers.manage` | `{numberId}` → busca no WhatsApp (`GET /group/fetchAllGroups`) e devolve a lista |
| PATCH | `/groups/:id` | `numbers.manage` | `{authorized: boolean}` — marca/desmarca |

## Grupos nas conversas

Recurso de plano **`groups_inbox`** ("Grupos nas conversas"). O admin marca **Conversas** no
grupo (`PATCH /groups/:id/inbox`, `numbers.manage` + `@RequireFeature('groups_inbox')`), e as
mensagens dele passam a chegar ao painel. Independente da marcação de transmissão.

| Regra | Onde |
|---|---|
| Passa pelo filtro do webhook só se: grupo `inbox`, número não excluído e plano da conta com `groups_inbox`. Plano rebaixado ou desmarcado = volta a ser descartado em até 1 min (TTL da lista; na réplica que recebeu o PATCH, na hora) | `GroupInboxRegistry` |
| O grupo vira contato com `isGroup = true`, `phone` = jid (`…@g.us`) e nome da lista de grupos (`nameSource = manual`: o pushName de cada mensagem é de quem escreveu, não renomeia o grupo) | `InboundService.createGroupContact` |
| Conversa **sempre livre** (`ticketExempt`): sem fila, sem dono, sem pesquisa, sem automação (`quiet`), fora dos relatórios — mesmas regras dos [contatos isentos](contatos-isentos.md) | `inbound.service.ts` (`contact.isGroup`) |
| Quem escreveu fica em `messages.senderName`/`senderPhone` (pushName e telefone do `key.participant`, ou do `participantAlt` quando o participante vem como @lid; sem telefone se só houver @lid). A bolha mostra o nome acima do texto; a prévia da conversa sai como "Nome: texto"; a citação usa o nome | `remetenteDoGrupo` (`evolution.provider.ts`), `ChatPane` |
| Mensagem e recibo passam pelo ledger (`UsageService.record`) como qualquer outra | `inbound.service.ts` |
| Responder pelo painel envia para o jid do grupo. Não é "contato frio" (o admin liberou o grupo): não gasta vaga do dia | `ConversationsService.assertColdAllowed` |
| Grupo não entra na exportação de contatos nem no público de transmissão por contato (`not ct."isGroup"`) — para transmissão, grupo só entra pelos autorizados | `contacts.module.ts`, `segmentation.service.ts` |
| Histórico anterior (sync) não é importado para grupo | `ehMensagemDeConversa` (`evolution.provider.ts`) |

Limitações conhecidas: "marcar como lida" e reação enviadas pelo painel num grupo podem não
chegar ao WhatsApp (a Evolution pede o participante da mensagem, que não mandamos); falha é
silenciosa e não afeta a conversa.

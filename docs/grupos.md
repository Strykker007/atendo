# Grupos restritos (opt-in estrito)

Grupos do WhatsApp entram no sistema **só como destino de transmissão**, e só os que o admin
marcou um a um. Grupo nenhum abre atendimento.

## Regras

| Regra | Onde |
|---|---|
| **Descarte imediato no webhook**: todo evento de grupo (`@g.us`) — mensagem, status, edição, presença, `groups.*`, `group-participants.update` — sai do corpo **antes de enfileirar**. Não vira job, não grava no banco, não gera log, não abre conversa. Lote misto segue só com as conversas | `whatsapp/group-filter.ts` (`stripGroupEvents`), chamado em `WebhooksController.evolution` |
| Grupo **autorizado** também é descartado na entrada: ele é só destino. Por isso o filtro nem consulta a lista branca — seria um acesso ao banco por mensagem de grupo, e grupo movimentado manda centenas por minuto. O parser (`EvolutionProvider.parseWebhook`) e o histórico também ignoram `@g.us` (segunda barreira) | `group-filter.ts`, `evolution.provider.ts` |
| **Opt-in estrito**: grupo listado nasce `authorized = false`. Só entra em transmissão o marcado, do mesmo número da transmissão | `GroupsController`, `CampaignsService.create` |
| Desmarcado depois de criada a transmissão → o alvo falha com "Grupo não está mais autorizado" | `GroupSender.send` |
| Só QR Code (Evolution). A API oficial da Meta não envia para grupos | `GroupsController.sync`, `CampaignsService` |

## Tela

**Configurações → Empresa → Números de WhatsApp → Grupos autorizados** (`/configuracoes/grupos`).
Escolhe o número (só QR), **Buscar grupos do WhatsApp** (`POST /groups/sync`, número conectado)
e marca/desmarca cada grupo. Ressincronizar preserva as marcações; grupo de que o número saiu é
removido se estava desmarcado (o marcado fica, para o admin ver e desmarcar). Gerir exige
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

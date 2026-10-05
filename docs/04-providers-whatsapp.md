# 04 — Providers WhatsApp

## O contrato

Tudo que fala com o WhatsApp implementa `WhatsAppProvider` (`apps/api/src/modules/whatsapp/providers/provider.interface.ts`):

```ts
interface WhatsAppProvider {
  kind: 'meta' | 'evolution';
  connect(ctx): Promise<{ status; qrCode? }>;   // registra/valida o número
  disconnect(ctx): Promise<void>;
  destroy?(ctx): Promise<void>;                 // remove definitivamente (opcional)
  getStatus(ctx): Promise<NumberStatus>;
  send(ctx, OutboundMessage): Promise<SendResult>;
  markRead(ctx, externalMessageId): Promise<void>;
  revoke?(ctx, { to, externalId }): Promise<void>; // "apagar para todos" de mensagem nossa. Só Evolution (`DELETE /chat/deleteMessageForEveryone`, key com fromMe: true); a Cloud API da Meta não tem — ver apagar-mensagens.md
  react(ctx, { to, targetExternalId, targetFromMe, emoji }): Promise<void>; // emoji vazio = retirar. Meta: mensagem `type: 'reaction'`; Evolution: `POST /message/sendReaction` com a key (remoteJid + fromMe + id)
  verifyWebhook(headers, rawBody): void;        // lança se inválido
  parseWebhook(body): ParsedWebhook;            // → InboundMessage[], StatusUpdate[], connection?
}
```

`ctx` (`NumberContext`) traz `numberId`, `tenantId`, `phone`, `externalId` e `config` (credenciais já descriptografadas).

**Regra de ouro:** UI, banco, filas e relatórios só conhecem `InboundMessage` / `OutboundMessage` (`packages/shared/src/messages.ts`). Qualquer detalhe da Meta ou da Evolution fica dentro do adapter.

## Como a troca funciona

O número tem um campo `provider` e um `providerConfig` (criptografado). `ProviderRegistry.get(number.provider)` devolve o adapter certo em tempo de execução. Não há restart nem deploy.

`NumbersService.switchProvider(numberId, provider, config)`:

1. `disconnect()` no provider atual (best-effort).
2. Atualiza `provider`, `externalId` e `providerConfig` (criptografado).
3. `connect()` no novo → devolve status (e QR, na Evolution).
4. Salva o status. Conversas e mensagens não são tocadas — a chave é o telefone do contato.

Na UI: *Números → Trocar provider*. Endpoint: `PUT /numbers/:id/provider`.

## Comparação

| | Meta Cloud API (oficial) | Evolution API (não-oficial) |
|---|---|---|
| Número | Precisa estar numa WABA (conta comercial Meta); não pode estar em uso no app comum | Qualquer número, inclusive o pessoal |
| Conexão | Token permanente + `phone_number_id` | QR code (emula WhatsApp Web via Baileys) |
| Custo por mensagem | Resposta na janela de 24h: **R$ 0**. Template: cobrado por mensagem entregue, por categoria | R$ 0 |
| Iniciar conversa | Só com template aprovado | Livre |
| Risco | Nenhum | Banimento do número; viola ToS da Meta |
| Estabilidade | Alta | Quebra quando o WhatsApp muda protocolo; depende de atualização da lib |
| Grupos | Não | Sim (ignoramos no atendimento) |

## Meta Cloud API

**`providerConfig`:** `{ accessToken, phoneNumberId, wabaId }`.

**Onde pegar:** developers.facebook.com → seu app → WhatsApp → Configuração da API. O token deve ser de um **System User** (permanente), com permissão `whatsapp_business_messaging`.

**Webhook:** configure no app da Meta a URL pública `https://<seu-dominio>/webhooks/meta` e o verify token igual a `META_WEBHOOK_VERIFY_TOKEN`. Assine o campo `messages`. Em dev use um túnel (ngrok, cloudflared).

**Assinatura:** cada POST vem com `X-Hub-Signature-256: sha256=<hmac>`. Calculamos o HMAC do **corpo bruto** (`rawBody: true` no Nest) com `META_APP_SECRET` e comparamos em tempo constante. Se `META_APP_SECRET` estiver vazio, a verificação é pulada (só para dev).

**Janela de 24h:** `Conversation.lastInboundAt` guarda a última mensagem do contato. `ConversationsService.send` recusa mensagem livre fora da janela — o atendente precisa mandar um template. O template vai em `OutboundMessage.template` com `category` (`utility | marketing | authentication`) que define o custo.

**Categorias de cobrança (`BillingCategory`):** `service` = resposta livre na janela (grátis); `utility`, `marketing`, `authentication` = templates (pagos); `unofficial` = Evolution (grátis).

## Evolution API

**`providerConfig`:** `{ instanceName }`. O nome é gerado: `atendo-<8 chars do tenant>-<telefone>`.

**Ciclo do QR (o que o adapter faz em `connect()`):** se a instância está `open`, não faz nada (reabrir criaria uma segunda sessão e o WhatsApp derrubaria a primeira). Se está `close`, faz `logout` antes de `connect` para descartar credenciais mortas e obter um pareamento novo. Caso contrário cria/conecta e devolve o QR.

**Como conectamos:** `POST /instance/create` com `qrcode: true` e um `token` que nós geramos → resposta já traz o QR em base64. Se a instância existe, `GET /instance/connect/:name` gera QR novo.

**Webhook global:** no compose, `WEBHOOK_GLOBAL_URL=http://host.docker.internal:4000/webhooks/evolution`. Todas as instâncias mandam para lá; o campo `instance` do corpo diz qual número é.

### Menus interativos (botões e listas)

`OutboundMessage.interactive` = `{ options: [{id, title, description?}], listButton?, header?, footer? }`. O motor de fluxos (Menu, Agendar, confirmações) e os lembretes de agenda usam isso.

| Provider | Como sai | Como volta |
|---|---|---|
| **Meta** | até 3 opções → **botões**; 4–10 → **lista** (`interactive.type = list`) | `messages[].type = 'interactive'` com `button_reply`/`list_reply` → `InboundMessage.interactiveReplyId` + `text` = título |
| **Evolution** | texto + **lista numerada** ("1 - Corte", "2 - Barba") — botões não são confiáveis em contas não-oficiais desde 2022 (muitos aparelhos não renderizam) | número, ou texto da opção |

O motor aceita a resposta por **id do botão, número ou texto** (`FlowEngineService.choose`). Assim o mesmo fluxo funciona nos dois providers e ganha botões de verdade quando o cliente migra para a Meta. No histórico do painel a mensagem interativa aparece como texto + opções numeradas.

### Sessão zumbi ("Connection Closed")

A Evolution pode dizer `open` enquanto o WebSocket com o WhatsApp já morreu (típico depois de o host dormir). Todo envio devolve `428 Connection Closed`. Tratamento automático: o `OutboundProcessor` detecta a mensagem, chama `provider.restart()` (`POST /instance/restart/:name`) e deixa o retry do BullMQ reenviar. Além disso, um job a cada 5 min (`NumbersHealthProcessor`) confere o status real de cada número no provider e corrige o banco (a UI mostra "desconectado" e o botão de reconectar). Se nem o restart resolver, reinicie o container (`docker compose restart evolution`) — as sessões ficam no banco da Evolution e reconectam sem QR.

### Autenticação do webhook

A Evolution **não** manda header de autenticação no webhook global; ela manda `apikey` **no corpo**, e esse valor é o token da instância. Então:

1. Ao criar a instância passamos `token = HMAC-SHA256(EVOLUTION_API_KEY, instanceName)`.
2. No webhook, lemos `body.instance`, recalculamos o HMAC e comparamos com `body.apikey` em tempo constante.

Sem consulta ao banco, sem segredo extra, e uma instância comprometida não afeta as outras. Para testes manuais, o header `apikey: <EVOLUTION_API_KEY>` também é aceito.

### Eventos que tratamos

| Evento | O que fazemos |
|---|---|
| `messages.upsert` | Mensagens de contatos e do celular do cliente (`fromMe`), reações e edições; ignora grupos `@g.us`. Tipos: ver [Tipos de mensagem recebida](#tipos-de-mensagem-recebida) |
| `messages.update` | Status (texto ou número do Baileys): `SERVER_ACK`/2→sent, `DELIVERY_ACK`/3→delivered, `READ`/4 e `PLAYED`/5 (áudio ouvido)→read, `ERROR`/0→failed. `InboundService.applyStatus` não deixa regredir (e ignora falha tardia de algo já entregue) e reemite a mensagem pelo evento `message` do socket |
| `connection.update` | `open`→connected; `connecting` é **transitório** (o WhatsApp reinicia o socket logo após parear) e não derruba um número já conectado; `close` com `statusReason 401`→ deslogado pelo celular (dispositivo removido). Traz `wuid` (número real que escaneou): se for diferente do cadastrado, o telefone é corrigido |
| `qrcode.updated` | QR novo → painel atualiza pelo socket |
| `presence.update` | "Digitando…"/"gravando áudio…" do contato (`composing`/`recording`; o resto vira `paused`). Não grava nada: acha a conversa do contato no número e emite `typing` no socket. Exige `WEBHOOK_EVENTS_PRESENCE_UPDATE=true` no compose **e** assinatura: o WhatsApp só manda o "digitando" de quem você assinou (`presenceSubscribe`), e a Evolution só assina nos chatbots dela. Por isso `POST /conversations/:id/read` (abrir a conversa) chama `NumbersService.subscribePresence` → `POST /chat/sendPresence` com `presence: 'paused'` (assina sem o contato ver nada), no máximo uma vez a cada 2 min por contato. A assinatura cai quando a sessão da Evolution reconecta; reabrir a conversa assina de novo. Grupos ignorados. **Meta não tem equivalente** — a Cloud API não avisa quando o contato digita, então números oficiais nunca mostram o indicador |

### Tipos de mensagem recebida

Nada deve virar bolha vazia. Cada adapter traduz o payload para `type` + `text` + `media` + `content` (`MessageContent` no shared: `buttons` | `list` | `location` | `contacts`). O corpo sempre vai em `text` — busca, prévia, IA, opt-out e fluxos continuam funcionando sem conhecer a estrutura.

| Recebido | Evolution (Baileys) | Meta | Vira |
|---|---|---|---|
| Texto | `conversation`, `extendedTextMessage` | `text` | `text` |
| Mídia | `image/video/ptv/audio/document/stickerMessage` (figurinha também é baixada) | `image/video/audio/document/sticker` | `image`… + `media` |
| Localização | `locationMessage`, `liveLocationMessage` | `location` | `location` + `content.kind='location'` |
| Contato (vCard) | `contactMessage`, `contactsArrayMessage` (telefone pelo `waid`) | `contacts` | `contact` + `content.kind='contacts'` |
| Botões / template | `buttonsMessage`, `templateMessage` (hydrated), `interactiveMessage` (nativeFlow: `cta_copy`, `cta_url`, `cta_call`, `quick_reply`) | — (empresa não recebe) | `interactive` + `content.kind='buttons'` |
| Lista | `listMessage`, `interactiveMessage` com `single_select` | — | `interactive` + `content.kind='list'` |
| Resposta a botão/lista | `buttonsResponseMessage`, `listResponseMessage`, `templateButtonReplyMessage`, `interactiveResponseMessage` | `interactive` (`button_reply`/`list_reply`/`nfm_reply`), `button` | `text` + `interactiveReplyId` |
| Enquete | `pollCreationMessage*` | — | `text` ("📊 pergunta + opções") |
| Reação | `reactionMessage` | `reaction` | marca a reagida (não é mensagem) |
| Edição | `protocolMessage` com `editedMessage` → `ParsedWebhook.edits` → `InboundService.applyEdit` troca o `text` da original | — | não cria mensagem |
| Apagar / config. de temporárias | outros `protocolMessage` | — | descartado |
| Qualquer outro | fallback `textoQualquer` (`providers/payload-text.ts`): primeiro `conversation`/`text`/`caption`/`hydratedContentText`/`contentText`/`body`/… achado no payload | idem (`unsupported`, `system`, tipos novos) | `text`; só sem texto nenhum fica `unknown` |

Envelopes (`ephemeralMessage`, `viewOnceMessage*`, `documentWithCaptionMessage`, `editedMessage`) são desembrulhados antes (`desembrulhar` em `providers/evolution-content.ts`), e o `contextInfo` (citação, anúncio, encaminhada) é procurado em qualquer nó da mensagem.

**Encaminhada**: Evolution lê `contextInfo.isForwarded` + `forwardingScore`; Meta lê `context.forwarded` / `context.frequently_forwarded` (sem score — `frequently` vira 5). Vai para `Message.forwarded`/`forwardingScore`. Mensagem encaminhada traz `context` sem `id` na Meta: não é citação.

**Encaminhar pelo painel** (`POST /conversations/:id/messages/:messageId/forward`) é um envio comum por destino. Nenhum dos dois providers aceita marcar o envio como encaminhado (a Cloud API não tem o campo; os endpoints REST da Evolution não expõem `contextInfo`), então o contato recebe uma mensagem normal — o selo "Encaminhada" existe só no nosso histórico.

### Mídia

Os providers **nunca precisam de URL pública** do nosso storage:

| Sentido | Meta | Evolution |
|---|---|---|
| Receber | `GET /{media-id}` devolve URL temporária; baixamos com o token | `POST /chat/getBase64FromMediaMessage/:instance` devolve base64 |
| Enviar | Upload do binário em `POST /{phone_number_id}/media` → envia pelo `id` | `sendMedia` / `sendWhatsAppAudio` com o conteúdo em base64 |

O `InboundProcessor` chama `provider.fetchMedia()` depois de gravar a mensagem; se falhar, a mensagem fica com `error = "Mídia indisponível: …"` e a UI mostra isso (a mensagem de texto nunca se perde por causa da mídia). O `OutboundProcessor` lê o arquivo do storage e passa como `MediaPayload` para `provider.send()`. Ver [03 — Arquitetura › Storage](03-arquitetura.md#storage-de-mídia).

## Origem do lead (atribuição de anúncio)

Quando o contato chega por um anúncio **Click-to-WhatsApp** (Instagram/Facebook), a primeira mensagem traz metadados do anúncio. Cada adapter normaliza isso em `InboundMessage.referral` (`LeadReferral` no shared):

| Provider | De onde vem | O que traz |
|---|---|---|
| Meta | `message.referral` | `source_type` (ad/post), `source_id`, `source_url`, `headline`, `body`, `ctwa_clid`, mídia do anúncio — completo e confiável |
| Evolution | `contextInfo.externalAdReply` (ou `conversionSource`) | `title`, `body`, `sourceUrl`, `sourceId`, `ctwaClid` — depende do que o protocolo expõe; às vezes parcial |

Na ingestão (`ConversationsService.ingestInbound`):
1. `Conversation.origin` = `ad` | `post` | `link` | `organic` (padrão) e `originData` = o referral inteiro.
2. Lead de anúncio ganha automaticamente as tags **"Anúncio"** e **"Anúncio: <título>"** (criadas por tenant, cor laranja). Isso alimenta filtro e relatório sem configuração.
3. Se o referral chegar em mensagem posterior de uma conversa orgânica aberta, a origem é atualizada.

Na UI: chip laranja "Anúncio" na lista e no cabeçalho (com o título e link para o anúncio); filtro por origem abaixo das tags. Relatórios: `groupBy: 'origin'` e `groupBy: 'campaign'` (título do anúncio), filtro `origin`.

`ctwa_clid` fica guardado para, no futuro, enviar conversões de volta ao Ads Manager (Conversions API).

## Adicionando um terceiro provider

1. Crie `providers/<nome>.provider.ts` implementando `WhatsAppProvider`.
2. Adicione o valor no enum `WhatsAppProvider` do `schema.prisma` e em `WhatsAppProviderKind` no shared; rode `pnpm db:migrate`.
3. Registre no `ProviderRegistry` e no `WhatsAppModule`.
4. Adicione a opção no `ProviderForm` do front.

Nada mais precisa mudar.


## Proteção contra bloqueio e banimento

O WhatsApp pune padrão de robô no número **não oficial**: rajada de mensagens, intervalo
sempre igual e volume alto num número recém-conectado. Três defesas, configuradas por
número na tela **Números**:

| Defesa | Como funciona |
|---|---|
| **Intervalo entre envios** | Faixas `instant` (só oficial), `fast` 1–7s, `short` 7–25s (padrão), `medium` 25–60s, `long` 60–250s. O valor é **sorteado dentro da faixa a cada envio** — intervalo fixo é assinatura de robô |
| **Teto diário** | Máximo de envios por dia por número (0 = sem teto). Ao atingir, a mensagem falha com motivo claro e **sem retry** — não adianta tentar de novo hoje |
| **Aquecimento** | Número novo começa em 20 envios/dia e dobra a cada dia por 7 dias, até o teto configurado. Começa sozinho na primeira conexão |

Implementação: `sending-policy.ts` (puro e testado) decide faixa, teto e rampa;
`SendPacer` reserva a vaga do próximo envio no Redis com **script Lua atômico** — com
vários workers, ler e gravar em duas etapas faria dois jobs disparem juntos, que é
exatamente a rajada que se quer evitar.

Quando um envio precisa esperar, o job volta para a fila com atraso (`moveToDelayed`) em
vez de segurar o worker parado. A vaga é reservada **uma vez só** e guardada em
`pacedUntil` no job: sem isso, cada reentrada reservaria uma vaga nova e o job se
empurraria para frente indefinidamente, sem nunca enviar.

Envio que falha no provider **não** conta no teto do dia — o teto é sobre o que realmente
saiu.

Além destas, a fila aplica limites por minuto do número, intervalo mínimo e rajada por
conversa, ordem por conversa e pausa quando o número cai — ver [Envio](envio.md).


## Mensagem enviada pelo celular do cliente

O WhatsApp entrega as mensagens que **saem** do número no mesmo evento das recebidas
(`messages.upsert` com `key.fromMe`). O parser descartava todas, e isso misturava dois casos
bem diferentes:

| Caso | O que deve acontecer |
|---|---|
| O painel acabou de enviar | descartar — a mensagem já está no banco |
| O cliente digitou no celular dele | **entrar no histórico como enviada** |

Descartar os dois deixava o painel com metade da conversa: aparecia o que o contato escreveu
e sumia o que o cliente respondeu do aparelho.

Hoje o parser marca `fromMe` e quem decide é o `ConversationsService`:

- o eco do próprio painel cai na **idempotência por `externalId`** (já está no banco);
- o resto vira mensagem `out` sem autor, por `ingestFromDevice`.

Três cuidados nesse caminho:

1. **Não aciona automação.** Disparar um fluxo por algo que o próprio cliente escreveu seria
   o robô respondendo ao dono do número. O `InboundProcessor` pula fluxos, agenda e
   descadastro quando `fromMe`.
2. **Não mexe em `lastInboundAt` nem nas não-lidas.** Quem falou foi o cliente, não o contato
   — e `lastInboundAt` reabriria a janela de 24h da Meta sem o contato ter escrito.
3. **Cria a conversa se não houver.** Conversa iniciada pelo celular precisa existir no
   painel, senão a resposta do contato abriria outra e o histórico nasceria partido.

Vale só para a Evolution: na API oficial o número não é operado por um aparelho.

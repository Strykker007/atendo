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

### Autenticação do webhook

A Evolution **não** manda header de autenticação no webhook global; ela manda `apikey` **no corpo**, e esse valor é o token da instância. Então:

1. Ao criar a instância passamos `token = HMAC-SHA256(EVOLUTION_API_KEY, instanceName)`.
2. No webhook, lemos `body.instance`, recalculamos o HMAC e comparamos com `body.apikey` em tempo constante.

Sem consulta ao banco, sem segredo extra, e uma instância comprometida não afeta as outras. Para testes manuais, o header `apikey: <EVOLUTION_API_KEY>` também é aceito.

### Eventos que tratamos

| Evento | O que fazemos |
|---|---|
| `messages.upsert` | Mensagens de contatos (ignora `fromMe` e grupos `@g.us`) |
| `messages.update` | Status: `SERVER_ACK`→sent, `DELIVERY_ACK`→delivered, `READ`→read |
| `connection.update` | `open`→connected; `connecting` é **transitório** (o WhatsApp reinicia o socket logo após parear) e não derruba um número já conectado; `close` com `statusReason 401`→ deslogado pelo celular (dispositivo removido). Traz `wuid` (número real que escaneou): se for diferente do cadastrado, o telefone é corrigido |
| `qrcode.updated` | QR novo → painel atualiza pelo socket |

### Mídia

Os providers **nunca precisam de URL pública** do nosso storage:

| Sentido | Meta | Evolution |
|---|---|---|
| Receber | `GET /{media-id}` devolve URL temporária; baixamos com o token | `POST /chat/getBase64FromMediaMessage/:instance` devolve base64 |
| Enviar | Upload do binário em `POST /{phone_number_id}/media` → envia pelo `id` | `sendMedia` / `sendWhatsAppAudio` com o conteúdo em base64 |

O `InboundProcessor` chama `provider.fetchMedia()` depois de gravar a mensagem; se falhar, a mensagem fica com `error = "Mídia indisponível: …"` e a UI mostra isso (a mensagem de texto nunca se perde por causa da mídia). O `OutboundProcessor` lê o arquivo do storage e passa como `MediaPayload` para `provider.send()`. Ver [03 — Arquitetura › Storage](03-arquitetura.md#storage-de-mídia).

## Adicionando um terceiro provider

1. Crie `providers/<nome>.provider.ts` implementando `WhatsAppProvider`.
2. Adicione o valor no enum `WhatsAppProvider` do `schema.prisma` e em `WhatsAppProviderKind` no shared; rode `pnpm db:migrate`.
3. Registre no `ProviderRegistry` e no `WhatsAppModule`.
4. Adicione a opção no `ProviderForm` do front.

Nada mais precisa mudar.

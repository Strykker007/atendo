# 06 — Modelo de dados

Fonte: `apps/api/prisma/schema.prisma`. Todas as tabelas de dados de cliente têm `tenantId` e `onDelete: Cascade` a partir do tenant.

```
tenants ─┬─ users ─── refresh_tokens
         ├─ whatsapp_numbers ─┐
         ├─ contacts ─────────┼─ conversations ─┬─ messages ─── message_usage
         │                    │                 └─ conversation_events
         ├─ tags ─────────────┘   (conversation_tags)
         ├─ quick_reply_folders ── quick_replies
         ├─ subscriptions ── plans
         ├─ usage_counters, usage_alerts, invoices
         └─ saved_reports

provider_pricing (global, sem tenant)
```

## Tabelas e por que existem

### Tenancy

**tenants** — o cliente. `slug` único para URLs/identificação. `stripeCustomerId` criado no primeiro checkout.

**users** — `tenantId` null só para `super_admin`. `passwordHash` argon2id. `totpSecret` reservado para 2FA.

**departments** / **user_departments** — departamentos do cliente (nome único, cor, ativo) e quem participa (N:N; sem linha = sem restrição). `conversations.departmentId` opcional (`SetNull` ao excluir). Ver [Departamentos](departamentos.md).

**refresh_tokens** — só o hash SHA-256 do token; `revokedAt` permite logout e rotação. Guardamos `userAgent`/`ip` para auditoria.

### WhatsApp

**whatsapp_numbers** — um canal. Campos-chave:
- `provider` (`meta | evolution`) — a troca é aqui.
- `externalId` — `phone_number_id` (Meta) ou `instanceName` (Evolution). Único por provider: é como o webhook acha o número.
- `providerConfig` — credenciais criptografadas (string, não json, de propósito).
- `status` — `connected | pending_qr | disconnected | error`.
- `infraCostMonth` — rateio para margem (Evolution).
- `deletedAt` — número **excluído** (arquivado). O registro fica com conversas, mensagens e agenda; some da lista de números e da caixa de entrada. `externalId` vira `removed:<id>` para liberar o instanceName/phone_number_id. Cadastrar o **mesmo telefone na mesma conta** (único `tenantId + phone`) revive o registro e o histórico volta — com ou sem o nono dígito (`phoneVariants`), porque depois de conectar o telefone gravado é o que o WhatsApp informa, muitas vezes sem o 9; havendo mais de um arquivado, volta o com mais conversas; em outra conta nasce um número novo, sem histórico.
- `sendLimits` — JSON `Partial<SendLimits>`: limites da fila de envio que esta conexão sobrescreveu (por minuto, intervalo/rajada por conversa, expiração); nulo = padrão do provider. Ver [Envio](envio.md).
- `color` — cor do canal (`#rrggbb`, padrão `#64748b`). Só visual: identifica o número no selo da lista de conversas e no cabeçalho do chat. A conversa já pertence a um número (`conversations.numberId`) e a resposta sai sempre por ele.

**contacts** — telefone E.164 único por tenant. Nome vem do `pushName`/profile do WhatsApp.

**conversations** — a conversa com uma pessoa num número, **uma só, para sempre** (`@@unique(numberId, contactId)`). O que começa e termina é o *atendimento*, registrado em `conversation_events`. Antes, encerrar e receber mensagem de novo criava outra linha: o mesmo contato aparecia duas vezes na tela, uma em "encerrado" e outra em "aguardando", com o histórico partido. A migration `conversa_unica` juntou o que já estava partido (mantendo a conversa mais antiga, que guarda quando a relação começou, e os campos de "agora" da mais recente). `awaitingSince` = desde quando o contato espera resposta: marcado na mensagem recebida (mantendo a **primeira** sem resposta — cinco mensagens seguidas são uma espera só) e limpo em qualquer saída, inclusive a enviada pelo celular. É coluna própria porque "quem espera há mais tempo" precisa ser ordenável: comparar `lastInboundAt` com `lastMessageAt` dá para ler, não dá para ordenar nem filtrar (Prisma não compara coluna com coluna). `origin` (`organic | ad | post | link`) e `originData` (referral do anúncio) — ver [04 › Origem do lead](04-providers-whatsapp.md#origem-do-lead-atribuição-de-anúncio). Único aberto por (número, contato); encerrar e receber de novo cria outra linha. `lastInboundAt` define a janela de 24h da Meta. `unreadCount` para o badge. `summaryCache`/`summaryLastMessageId`/`summaryUpdatedAt` = cache do resumo por IA: vale enquanto `summaryLastMessageId` for a última mensagem da conversa (ver [15 › API](15-ia.md#api)). Índice em `(tenantId, status, lastMessageAt desc)` = a query da lista. `botPausedAt`/`botPausedById`/`botPausedUntil` = robô pausado só nesta conversa (`botPausedUntil` nulo = até retomar manualmente; encerrar limpa) — ver [fluxos › Pausar o robô](fluxos.md#pausar-o-robô-na-conversa).

**conversation_events** — histórico do atendimento (auditoria). A conversa guarda só a foto do momento: dono atual, data do fechamento, último resultado. Isso não responde "quantos atendimentos a Ana fechou em março", e reabrir **limpa** o desfecho da conversa, então o resultado anterior deixava de existir.

Cada linha é um fato: `claimed`, `transferred`, `released`, `closed`, `reopened`, `bot_paused` (`reason` = duração), `bot_resumed` (ator nulo = fim do tempo ou encerramento, dito em `reason`), `message_deleted` / `history_cleared` (`reason` diz o que e onde foi apagado, nunca o conteúdo — [Apagar mensagens](apagar-mensagens.md)), com `actorId` (nulo = automação), `targetId` (transferência), status de/para e o desfecho **copiado** — congelado ali, para que reabrir não mude o número de um mês já fechado. Linha gravada nunca é alterada nem apagada.

Cada `closed` é **um atendimento**: a mesma pessoa volta semanas depois, na mesma conversa, e aquilo é outro atendimento, com outro dono e outro resultado. Índices por `(tenantId, type, createdAt)` e `(tenantId, actorId, createdAt)` = a base do relatório por atendente e período. Começa a valer da estreia em diante; o que aconteceu antes não foi gravado.

**messages** — `numberId` = número por onde a mensagem entrou/saiu (null em nota interna). O worker envia por **este** número, não pelo da conversa na hora do envio; linhas anteriores à migration `message_number` foram preenchidas com o número da conversa. `externalId` único → idempotência de webhook. `raw` guarda o payload original (debug e reprocessamento). `authorId` = atendente que enviou. `internal` = nota interna (só a equipe vê; criada já `delivered`, nunca entra na fila de envio — `enqueueOutbound`, `planSend` e o `OutboundProcessor` recusam; não passa pelo `UsageService`). `authorName` = nome do autor gravado na nota interna (migration `message_author_name`), para a nota seguir assinada depois que o usuário é removido (`authorId` vira null). `reactions` (json, `MessageReaction[]`) = reações de emoji (recebidas e as do atendente, `fromMe: true`): reação **não** é mensagem (não entra no histórico, não passa pelo `UsageService`, não aciona fluxo), só marca a reagida. No 1:1 cada lado (contato / celular do cliente) tem no máximo uma; a nova substitui e emoji vazio retira. Antes da migration `message_reactions` a reação entrava como mensagem `unknown` citando a reagida — essas linhas antigas continuam no banco. `content` (json, `MessageContent` do shared) = o que não cabe em `text`/`media`: botões, lista, localização, contatos (o corpo continua em `text`). `forwarded` / `forwardingScore` = encaminhada (pelo contato, informado pelo provider, ou pelo atendente via "Encaminhar"; score ≥ 5 = "com frequência"). Mensagens anteriores à migration `message_content_forwarded` não têm `content`: localização/contato antigos aparecem com o aviso genérico. Fila de envio ([Envio](envio.md)): `queueSeq` (BIGSERIAL) = ordem na fila — numa conversa só sai a pendente de menor `queueSeq`; "Tentar novamente" pega um novo; `queuedAt` = entrada na fila (base da expiração); `idempotencyKey` com unique `(conversationId, idempotencyKey)` = mesmo envio repetido devolve a mesma linha. Índice `(conversationId, status, queueSeq)` = a consulta da vez. Apagada ([Apagar mensagens](apagar-mensagens.md), migration `message_delete`): `deletedAt` preenchido = apagada — a linha **nunca** sai do banco (ledger e auditoria), o original fica nas próprias colunas e o `present()` o esconde; `deletedById` (sem FK) + `deletedByName` = quem apagou; `deletedForEveryone` = o provider apagou também no celular do contato.

**tags** / **conversation_tags** — N:N. Índice em `tagId` para o filtro por tag.
- `tags.isKanban` (default `true`) faz da tag uma coluna do Kanban; `tags.position` é a ordem da coluna (tag nova entra no fim).
- `conversation_tags.isPrimary` marca a **tag principal** = etapa do atendimento no Kanban. No máximo uma por conversa, garantido em `ConversationsService.setPrimaryTag`/`setTags` com `SELECT … FOR UPDATE` na conversa (sem índice parcial: o Prisma 6 não o modela e o `migrate dev` seguinte o apagaria). Só tag com `isKanban` pode ser principal; desmarcar `isKanban` rebaixa as principais dela.

**quick_reply_folders** / **quick_replies** — painel direito. `position` para ordenação manual (arrastar na tela `/respostas`); item novo entra no fim (`max + 1`). A listagem ordena por `position` e o chat (painel e menu `/`) herda essa ordem.

### Cobrança

**plans** — `limits` jsonb (`PlanLimits`). `billingModel` informativo (`fixed | usage | hybrid`). `stripePriceId` (`price_…`) criado por `pnpm stripe:sync` (só `monthly`/`yearly`). `billingCycle` (`free | monthly | yearly | custom`), `isFree` (= `billingCycle = free`), `durationDays` (dias de gratuidade; null = permanente), `priceYear` (anual; `priceMonth` vira o equivalente mensal). Ver docs/05.

**subscriptions** — 1:1 com tenant. `status`: `trialing | active | past_due | suspended | canceled`. `externalId` = `sub_…` do Stripe; `cancelAtPeriodEnd`; `graceUntil`.

**provider_pricing** — histórico de preços por `(provider, country, category)`; sempre inserir, nunca editar.

**message_usage** — ledger, uma linha por mensagem. Ver [05](05-planos-e-cobranca.md).

**ai_usage** — ledger de IA, uma linha por chamada ao modelo (`kind`, modelo, tokens de
entrada e saída, custo em USD e BRL calculado na hora, latência, e `error` quando falhou).
É o que permite saber a margem da IA e aplicar o teto de gasto. Ver [15](15-ia.md).

**usage_counters** — agregado mensal reconciliado (`tenantId + period` únicos).

**usage_alerts** — quais alertas já disparamos (única por tenant/período/métrica/threshold).

**invoices** — espelho da fatura do Stripe: base + excedente, `externalId` (`in_…`), `hostedUrl`. Única por tenant/período.

### Relatórios

**sales** — uma linha por atendimento encerrado como **Comprou**: `conversationId`, `contactId`,
`userId` (quem encerrou; nulo = super_admin), `amount` (obrigatório), `products`, `notes`,
`closedAt`. Nunca alterada nem apagada — reabrir a conversa limpa `conversations.outcome*`, mas a
venda que já entrou no mês continua. É a base de conversão, ticket médio e faturamento por
atendente (índices por `tenantId + closedAt` e `tenantId + userId + closedAt`). Encerramento em
massa como *Comprou* não grava venda (não tem valor). Migração `20261028000000_close_flows_and_sales`.

**saved_reports** — `definition` jsonb com o `ReportDefinition` (métrica, agrupamento, filtros, tipo de gráfico).

## Enums

| Enum | Valores |
|---|---|
| Role | super_admin, tenant_admin, agent |
| WhatsAppProvider | meta, evolution |
| NumberStatus | connected, pending_qr, disconnected, error |
| ConversationStatus | waiting, in_progress, closed |
| MessageDirection | in, out |
| MessageType | text, image, audio, video, document, sticker, location, contact, template, interactive (botões/lista/template recebidos), unknown (só quando nem o fallback achou texto) |
| MessageStatus | pending, sent, delivered, read, failed |
| BillingCategory | service, utility, marketing, authentication, unofficial |
| SubscriptionStatus | trialing, active, past_due, suspended, canceled |
| InvoiceStatus | draft, open, paid, failed, void |

Os mesmos enums existem em `packages/shared/src/enums.ts` para o front. Ao mudar um, mude nos dois.

## Mudando o schema

```bash
# edite apps/api/prisma/schema.prisma
pnpm db:migrate        # cria migration + aplica + regenera client
```

Em produção: `pnpm --filter @atendo/api prisma migrate deploy`.


## Configurações do cliente

**tenant_settings** — fuso horário do cliente (usado pela agenda, pelos fluxos e pelos
relatórios), chave `attendanceActive` (feriado/férias: vale a faixa Fechado sem mexer nos
horários) + `attendanceChangedAt`, fluxos padrão (inclusive `wonFlowId`/`lostFlowId`/`noneFlowId`,
o fluxo de encerramento por resultado) e **boas-vindas** (`welcomeEnabled`,
`welcomeMessages`, `welcomeMode`, `welcomeCursor`) e `quickReplyDelaySec` (contagem antes de a resposta rápida sair; 0 = na hora — [Envio](envio.md#respostas-rápidas)).

**business_schedules** — quadros de horários ([Horários](horarios.md)): `name`, `timezone`,
`isDefault` (um por cliente) e `config` (JSON `ScheduleConfig`: faixas, Fechado, grade semanal,
exceções por data). `whatsapp_numbers.scheduleId` = quadro próprio do número (nulo = padrão).
Cliente sem quadro = sempre aberto. `conversations.scheduleNoticeKey` = período da faixa cuja
resposta já foi enviada (uma vez por conversa a cada período). Substituiu `business_hours` e
`outsideHoursText` (migração `20261005000000_business_schedules`).


**contacts.nameSource** (`whatsapp` | `agenda` | `manual`) diz de onde veio o nome e quem pode trocá-lo — ver [providers › De onde vem o nome do contato](04-providers-whatsapp.md#de-onde-vem-o-nome-do-contato-contactsnamesource).

**contacts** ganhou a ficha preenchida pelo atendente: `email`, `address`, `note1` e
`note2`. Campo enviado vazio vira `null` — o atendente apaga o que não vale mais.

**contact_attributes** — campos livres da ficha de **um** contato (`label`, `type`
`ContactAttributeType`: text, number, date, `value` em texto, `position`). Cada cliente tem os
seus; não há cadastro de campos da empresa. Ver [Campos personalizados](campos-personalizados.md).

**global_variables** — variáveis da empresa (`key` única por tenant, minúsculas/números/`_`; `label`; `value`). Entram no envio como `{{global.<key>}}` e `{{<key>}}`. Ver [Variáveis](variaveis.md).

**scheduled_messages** — mensagem que o atendente agendou na conversa (`userId` = autor, `content`, anexo opcional por `mediaKey`, `scheduledFor`, `status` `ScheduledMessageStatus`: pending, sent, cancelled, failed + `error`, `messageId`). Job de 1 minuto envia pelo caminho do chat. Ver [Agendamento de mensagens](agendamento-de-mensagens.md).

**phonebook_entries** — agenda do celular de cada número (`numberId`, `phone`, `name`, `previousName` = nome antes da última troca, único por número + telefone), vinda da sincronização de contatos da Evolution. **Não é contato** e não aparece no painel; serve para o contato nascer com o nome da agenda. Cai junto com o número (cascade). `searchText` (também em **contacts**) é coluna **gerada** no banco só para a [busca textual](07-api.md#busca-textual-de-contatos), com índice GIN `pg_trgm`; o `PrismaService` a omite das respostas. Ver [providers › De onde vem o nome do contato](04-providers-whatsapp.md#de-onde-vem-o-nome-do-contato-contactsnamesource).

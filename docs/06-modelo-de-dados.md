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

**refresh_tokens** — só o hash SHA-256 do token; `revokedAt` permite logout e rotação. Guardamos `userAgent`/`ip` para auditoria.

### WhatsApp

**whatsapp_numbers** — um canal. Campos-chave:
- `provider` (`meta | evolution`) — a troca é aqui.
- `externalId` — `phone_number_id` (Meta) ou `instanceName` (Evolution). Único por provider: é como o webhook acha o número.
- `providerConfig` — credenciais criptografadas (string, não json, de propósito).
- `status` — `connected | pending_qr | disconnected | error`.
- `infraCostMonth` — rateio para margem (Evolution).
- `color` — cor do canal (`#rrggbb`, padrão `#64748b`). Só visual: identifica o número no selo da lista de conversas e no cabeçalho do chat. A conversa já pertence a um número (`conversations.numberId`) e a resposta sai sempre por ele.

**contacts** — telefone E.164 único por tenant. Nome vem do `pushName`/profile do WhatsApp.

**conversations** — a conversa com uma pessoa num número, **uma só, para sempre** (`@@unique(numberId, contactId)`). O que começa e termina é o *atendimento*, registrado em `conversation_events`. Antes, encerrar e receber mensagem de novo criava outra linha: o mesmo contato aparecia duas vezes na tela, uma em "encerrado" e outra em "aguardando", com o histórico partido. A migration `conversa_unica` juntou o que já estava partido (mantendo a conversa mais antiga, que guarda quando a relação começou, e os campos de "agora" da mais recente). `awaitingSince` = desde quando o contato espera resposta: marcado na mensagem recebida (mantendo a **primeira** sem resposta — cinco mensagens seguidas são uma espera só) e limpo em qualquer saída, inclusive a enviada pelo celular. É coluna própria porque "quem espera há mais tempo" precisa ser ordenável: comparar `lastInboundAt` com `lastMessageAt` dá para ler, não dá para ordenar nem filtrar (Prisma não compara coluna com coluna). `origin` (`organic | ad | post | link`) e `originData` (referral do anúncio) — ver [04 › Origem do lead](04-providers-whatsapp.md#origem-do-lead-atribuição-de-anúncio). Único aberto por (número, contato); encerrar e receber de novo cria outra linha. `lastInboundAt` define a janela de 24h da Meta. `unreadCount` para o badge. `summaryCache`/`summaryLastMessageId`/`summaryUpdatedAt` = cache do resumo por IA: vale enquanto `summaryLastMessageId` for a última mensagem da conversa (ver [15 › API](15-ia.md#api)). Índice em `(tenantId, status, lastMessageAt desc)` = a query da lista. `botPausedAt`/`botPausedById`/`botPausedUntil` = robô pausado só nesta conversa (`botPausedUntil` nulo = até retomar manualmente; encerrar limpa) — ver [fluxos › Pausar o robô](fluxos.md#pausar-o-robô-na-conversa).

**conversation_events** — histórico do atendimento (auditoria). A conversa guarda só a foto do momento: dono atual, data do fechamento, último resultado. Isso não responde "quantos atendimentos a Ana fechou em março", e reabrir **limpa** o desfecho da conversa, então o resultado anterior deixava de existir.

Cada linha é um fato: `claimed`, `transferred`, `released`, `closed`, `reopened`, `bot_paused` (`reason` = duração), `bot_resumed` (ator nulo = fim do tempo ou encerramento, dito em `reason`), com `actorId` (nulo = automação), `targetId` (transferência), status de/para e o desfecho **copiado** — congelado ali, para que reabrir não mude o número de um mês já fechado. Linha gravada nunca é alterada nem apagada.

Cada `closed` é **um atendimento**: a mesma pessoa volta semanas depois, na mesma conversa, e aquilo é outro atendimento, com outro dono e outro resultado. Índices por `(tenantId, type, createdAt)` e `(tenantId, actorId, createdAt)` = a base do relatório por atendente e período. Começa a valer da estreia em diante; o que aconteceu antes não foi gravado.

**messages** — `numberId` = número por onde a mensagem entrou/saiu (null em nota interna). O worker envia por **este** número, não pelo da conversa na hora do envio; linhas anteriores à migration `message_number` foram preenchidas com o número da conversa. `externalId` único → idempotência de webhook. `raw` guarda o payload original (debug e reprocessamento). `authorId` = atendente que enviou. `reactions` (json, `MessageReaction[]`) = reações de emoji (recebidas e as do atendente, `fromMe: true`): reação **não** é mensagem (não entra no histórico, não passa pelo `UsageService`, não aciona fluxo), só marca a reagida. No 1:1 cada lado (contato / celular do cliente) tem no máximo uma; a nova substitui e emoji vazio retira. Antes da migration `message_reactions` a reação entrava como mensagem `unknown` citando a reagida — essas linhas antigas continuam no banco. `content` (json, `MessageContent` do shared) = o que não cabe em `text`/`media`: botões, lista, localização, contatos (o corpo continua em `text`). `forwarded` / `forwardingScore` = encaminhada (pelo contato, informado pelo provider, ou pelo atendente via "Encaminhar"; score ≥ 5 = "com frequência"). Mensagens anteriores à migration `message_content_forwarded` não têm `content`: localização/contato antigos aparecem com o aviso genérico.

**tags** / **conversation_tags** — N:N. Índice em `tagId` para o filtro por tag.
- `tags.isKanban` (default `true`) faz da tag uma coluna do Kanban; `tags.position` é a ordem da coluna (tag nova entra no fim).
- `conversation_tags.isPrimary` marca a **tag principal** = etapa do atendimento no Kanban. No máximo uma por conversa, garantido em `ConversationsService.setPrimaryTag`/`setTags` com `SELECT … FOR UPDATE` na conversa (sem índice parcial: o Prisma 6 não o modela e o `migrate dev` seguinte o apagaria). Só tag com `isKanban` pode ser principal; desmarcar `isKanban` rebaixa as principais dela.

**quick_reply_folders** / **quick_replies** — painel direito. `position` para ordenação manual (arrastar na tela `/respostas`); item novo entra no fim (`max + 1`). A listagem ordena por `position` e o chat (painel e menu `/`) herda essa ordem.

### Cobrança

**plans** — `limits` jsonb (`PlanLimits`). `billingModel` informativo (`fixed | usage | hybrid`). `stripePriceId` (`price_…`) criado por `pnpm stripe:sync`.

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
horários) + `attendanceChangedAt`, fluxos padrão e **boas-vindas** (`welcomeEnabled`,
`welcomeMessages`, `welcomeMode`, `welcomeCursor`).

**business_schedules** — quadros de horários ([Horários](horarios.md)): `name`, `timezone`,
`isDefault` (um por cliente) e `config` (JSON `ScheduleConfig`: faixas, Fechado, grade semanal,
exceções por data). `whatsapp_numbers.scheduleId` = quadro próprio do número (nulo = padrão).
Cliente sem quadro = sempre aberto. `conversations.scheduleNoticeKey` = período da faixa cuja
resposta já foi enviada (uma vez por conversa a cada período). Substituiu `business_hours` e
`outsideHoursText` (migração `20261005000000_business_schedules`).


**contacts** ganhou a ficha preenchida pelo atendente: `email`, `address`, `note1` e
`note2`. Campo enviado vazio vira `null` — o atendente apaga o que não vale mais.

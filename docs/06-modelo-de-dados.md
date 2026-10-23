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
tenant_templates (global) ── tenants.templateId
```

## Tabelas e por que existem

### Tenancy

**tenants** — o cliente. `slug` único para URLs/identificação. `stripeCustomerId` / `asaasCustomerId` criados no primeiro checkout do gateway correspondente. Dados cadastrais (só o dono, tela Clientes → Editar): `legalName` (razão social), `document` (CPF/CNPJ, só dígitos), `contactName`, `billingEmail` (não é o login), `phone`, endereço (`zipCode`, `street`, `addressNumber`, `complement`, `district`, `city`, `state`) e `notes` — migração `20261031000000_tenant_profile`. `templateId` = modelo de perfil usado na criação (SetNull ao excluir o modelo) — migração `20261109000000_tenant_templates`.

**tenant_templates** — modelos de perfil (verticais) do dono do sistema: `name` único, `description`, `isDefault` (no máximo um, garantido na API — migração `20261110000000_tenant_template_default`), `content` (JSON: perfis, respostas rápidas, fluxos em formato portável, `lossReasons` e `lossReasonColors` opcionais). Só lido na criação do cliente — ver [20](20-modelos-de-perfil.md).

**users** — `tenantId` null só para `super_admin`. `isSystemOwner` (padrão `false`, migração `20270110000000_system_owner`) = dono do sistema sem trocar o papel: continua no cliente dele — ver [Donos do sistema](donos-do-sistema.md). `passwordHash` argon2id. `totpSecret` reservado para 2FA. `typingSpeed` (`slow`|`normal`|`fast`, padrão `normal`) = velocidade do "digitando…" simulado das mensagens que a pessoa não digitou ([Envio](envio.md#humanização)).

**companies** / **user_companies** — empresas/unidades do cliente (nome único por cliente, CNPJ opcional só com dígitos) e quem opera cada uma (N:N; sem linha = todas). `whatsapp_numbers.companyId` opcional (`SetNull` ao excluir): um número pertence a no máximo uma empresa. `companies.billingType` (`CONSOLIDATED_GROUP` herda a assinatura do cliente; `INDIVIDUAL` tem a própria) e `companies.isActive` (ativa para cobrança). Ver [Empresas](empresas.md).

**company_subscriptions** — assinatura própria de uma empresa em modo `INDIVIDUAL` (1:1 com `companies`): plano, `priceMonth` contratado (null = do plano), `status`, `currentPeriodEnd`. Só preço e vencimento — limites continuam na assinatura do cliente. Ver [Empresas → Cobrança](empresas.md#cobrança).

**departments** / **user_departments** — departamentos do cliente (nome único, cor, ativo) e quem participa (N:N; sem linha = sem restrição). `conversations.departmentId` opcional (`SetNull` ao excluir). Ver [Departamentos](departamentos.md).

**work_schedules** / **schedule_overrides** — escalas de trabalho do cliente (`type` `FIXED_12X36`|`COMMERCIAL_44H`|`CUSTOM`, `startTime`/`endTime` "HH:MM" locais, `workDays`, `restHours`, `anchorDate`, `toleranceMinutes`) e liberações excepcionais de plantão (`userId`, `validFrom`, `validUntil`, `approvedById`, `reason`, `revokedAt`). Em `users`: `scheduleId` (SetNull ao apagar a escala), `isTemporary`, `accessExpiresAt`, `expiredAt`, `temporaryCreatedById` — migração `20270103000000_work_schedules`. **schedule_access_requests** = pedidos de autorização feitos no login (`reason`, `approverId`, `status` `pending`|`approved`|`denied`, quem decidiu, `overrideId`) — migração `20270105000000_schedule_access_requests`. Ver [Escalas](escalas.md).

**refresh_tokens** — só o hash SHA-256 do token; `revokedAt` permite logout e rotação. Guardamos `userAgent`/`ip` para auditoria. Limpeza diária (03:30 UTC, fila `work-schedules`, `AuthService.purgeStaleRefreshTokens`): apaga vencidos e revogados há mais de 1 dia, mantendo sempre o mais recente de cada usuário (é a "última atividade" do Monitor).

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

**ignored_contacts** — telefones isentos de ticket por cliente (`phone` só dígitos, único por tenant); a conversa desses contatos fica com `conversations.ticketExempt = true` (chat livre, fora da fila e dos relatórios). Ver [Contatos isentos](contatos-isentos.md).

**internal_chats** / **internal_chat_members** / **internal_messages** — chat interno da equipe (direto ou grupo), histórico permanente e auditável por `internal_chat.audit`. Ver [Chat interno](chat-interno.md).

**staff_chats** / **staff_chat_members** / **staff_messages** — chat da equipe do suporte (super_admins entre si, fora de qualquer cliente): canal `team` com todos + diretas. Ver [Equipe do suporte](chat-interno.md#equipe-do-suporte).

**support_tickets** — atendimentos da fila de suporte (um ativo por canal de suporte): `number` sequencial (#123), `status` (`open`|`in_progress`|`resolved`), responsável (`assigneeId`/`assigneeName`), `openedAt`, `firstResponseAt`, `resolvedAt`. `whatsapp_numbers.syncStartedAt` = quando o número reconectou (aviso de sincronização). Migração `20270104000000_support_tickets_number_sync`. Ver [Fila de suporte](chat-interno.md#fila-de-suporte).

**whatsapp_groups** / **campaign_group_targets** — lista branca de grupos por número (opt-in estrito) e alvos de grupo da transmissão; ver [Grupos restritos](grupos.md). `authorized` = destino de transmissão; `inbox` (+ `inboxAt`/`inboxById`, migration `groups_inbox`) = aparece nas conversas. Só o grupo `inbox` vira contato (`contacts.isGroup`, `phone` = jid `…@g.us`) e conversa (sempre `ticketExempt`); `messages.senderName`/`senderPhone` = quem escreveu no grupo ([Grupos nas conversas](grupos.md#grupos-nas-conversas)).

**contacts** — telefone E.164 único por tenant (grupo nas conversas: `isGroup = true` e `phone` = jid do grupo; fica fora da exportação e do público de transmissão). Nome vem do `pushName`/profile do WhatsApp.

**conversations** — a conversa com uma pessoa num número, **uma só, para sempre** (`@@unique(numberId, contactId)`). O que começa e termina é o *atendimento*, registrado em `conversation_events`. Antes, encerrar e receber mensagem de novo criava outra linha: o mesmo contato aparecia duas vezes na tela, uma em "encerrado" e outra em "aguardando", com o histórico partido. A migration `conversa_unica` juntou o que já estava partido (mantendo a conversa mais antiga, que guarda quando a relação começou, e os campos de "agora" da mais recente). `awaitingSince` = desde quando o contato espera resposta: marcado na mensagem recebida (mantendo a **primeira** sem resposta — cinco mensagens seguidas são uma espera só) e limpo em qualquer saída, inclusive a enviada pelo celular. É coluna própria porque "quem espera há mais tempo" precisa ser ordenável: comparar `lastInboundAt` com `lastMessageAt` dá para ler, não dá para ordenar nem filtrar (Prisma não compara coluna com coluna). `origin` (`organic | ad | post | link`) e `originData` (referral do anúncio) — ver [04 › Origem do lead](04-providers-whatsapp.md#origem-do-lead-atribuição-de-anúncio). Único aberto por (número, contato); encerrar e receber de novo cria outra linha. `lastInboundAt` define a janela de 24h da Meta. `unreadCount` para o badge. `summaryCache`/`summaryLastMessageId`/`summaryUpdatedAt` = cache do resumo por IA: vale enquanto `summaryLastMessageId` for a última mensagem da conversa (ver [15 › API](15-ia.md#api)). Índice em `(tenantId, status, lastMessageAt desc)` = a query da lista. `botPausedAt`/`botPausedById`/`botPausedUntil` = robô pausado só nesta conversa (`botPausedUntil` nulo = até retomar manualmente; encerrar limpa) — ver [fluxos › Pausar o robô](fluxos.md#pausar-o-robô-na-conversa).

**conversation_events** — histórico do atendimento (auditoria). A conversa guarda só a foto do momento: dono atual, data do fechamento, último resultado. Isso não responde "quantos atendimentos a Ana fechou em março", e reabrir **limpa** o desfecho da conversa, então o resultado anterior deixava de existir.

Cada linha é um fato: `claimed`, `transferred`, `released`, `closed`, `reopened`, `bot_paused` (`reason` = duração), `bot_resumed` (ator nulo = fim do tempo ou encerramento, dito em `reason`), `message_deleted` / `history_cleared` (`reason` diz o que e onde foi apagado, nunca o conteúdo — [Apagar mensagens](apagar-mensagens.md)), com `actorId` (nulo = automação), `targetId` (transferência; no `closed` da automação — ator nulo — quem da equipe **atendeu**: o último que respondeu, sem nota interna, desde o encerramento anterior; só robô = nulo. Migração `20261204000000_automation_close_attendant` preencheu o histórico), status de/para e o desfecho **copiado** — congelado ali, para que reabrir não mude o número de um mês já fechado. No `closed`, `tagIds` = tags escolhidas no encerramento (opcionais; também somadas às tags da conversa) e `reason` = os nomes delas, congelados. Encerramento pelo atendente é sempre `won` ou `lost`; `none` sobra para o sistema (fluxo) e o histórico anterior. A migração `20261114000000_close_reasons_to_tags` preencheu `tagIds` dos "Não comprou" antigos cujo motivo bate com o nome de uma tag. Linha gravada nunca é alterada nem apagada.

`viaFlow` (migração `20261201000000_event_via_flow`) = nome do fluxo quando o encerramento com resultado (Comprou/Não comprou) foi feito pelo bloco **Encerrar conversa**; nesse caso `actorId` é o **dono da conversa**, que leva o crédito no ranking e nas metas (sem dono, nulo). O histórico mostra "Fluxo “X” encerrou" e "Conta para Fulano". Ver [fluxos › Ação](fluxos.md#ação).

Cada `closed` é **um atendimento**: a mesma pessoa volta semanas depois, na mesma conversa, e aquilo é outro atendimento, com outro dono e outro resultado. Índices por `(tenantId, type, createdAt)` e `(tenantId, actorId, createdAt)` = a base do relatório por atendente e período. Começa a valer da estreia em diante; o que aconteceu antes não foi gravado.

**messages** — `numberId` = número por onde a mensagem entrou/saiu (null em nota interna). O worker envia por **este** número, não pelo da conversa na hora do envio; linhas anteriores à migration `message_number` foram preenchidas com o número da conversa. `externalId` único **por número** (`(numberId, externalId)`, migration `message_external_id_per_number`; antes era único global) → idempotência de webhook. Quando um número nosso fala com outro (da mesma conta ou de outra conta do Atendo), o WhatsApp usa o mesmo id na saída de um e na entrada do outro: as duas linhas existem, e toda busca por `externalId` (duplicata, recibo de status, citação, reação, edição, histórico) filtra pelo número — o recibo traz `StatusUpdate.externalNumberId`. Com o único global, a entrada era descartada como duplicata da saída e a mensagem não aparecia no número que recebeu. `raw` guarda o payload original (debug e reprocessamento). `authorId` = atendente que enviou. `internal` = nota interna (só a equipe vê; criada já `delivered`, nunca entra na fila de envio — `enqueueOutbound`, `planSend` e o `OutboundProcessor` recusam; não passa pelo `UsageService`). `authorName` = nome do autor gravado na nota interna (migration `message_author_name`), para a nota seguir assinada depois que o usuário é removido (`authorId` vira null). `reactions` (json, `MessageReaction[]`) = reações de emoji (recebidas e as do atendente, `fromMe: true`): reação **não** é mensagem (não entra no histórico, não passa pelo `UsageService`, não aciona fluxo), só marca a reagida. No 1:1 cada lado (contato / celular do cliente) tem no máximo uma; a nova substitui e emoji vazio retira. Antes da migration `message_reactions` a reação entrava como mensagem `unknown` citando a reagida — essas linhas antigas continuam no banco. `content` (json, `MessageContent` do shared) = o que não cabe em `text`/`media`: botões, lista, localização, contatos (o corpo continua em `text`). `forwarded` / `forwardingScore` = encaminhada (pelo contato, informado pelo provider, ou pelo atendente via "Encaminhar"; score ≥ 5 = "com frequência"). Mensagens anteriores à migration `message_content_forwarded` não têm `content`: localização/contato antigos aparecem com o aviso genérico. Fila de envio ([Envio](envio.md)): `queueSeq` (BIGSERIAL) = ordem na fila — numa conversa só sai a pendente de menor `queueSeq`; "Tentar novamente" pega um novo; `queuedAt` = entrada na fila (base da expiração); `idempotencyKey` com unique `(conversationId, idempotencyKey)` = mesmo envio repetido devolve a mesma linha. Índice `(conversationId, status, queueSeq)` = a consulta da vez. Apagada ([Apagar mensagens](apagar-mensagens.md), migration `message_delete`): `deletedAt` preenchido = apagada — a linha **nunca** sai do banco (ledger e auditoria), o original fica nas próprias colunas e o `present()` o esconde; `deletedById` (sem FK) + `deletedByName` = quem apagou; `deletedForEveryone` = o provider apagou também no celular do contato. `imported` (migration `message_imported_history`) = veio do histórico guardado no provider, anterior à conversa no painel: não passa pelo `UsageService` e fica fora das métricas de mensagens ([Histórico](historico-de-mensagens.md)).

**tags** / **conversation_tags** — N:N. Índice em `tagId` para o filtro por tag.

**tag_conflicts** — pares de tags opostas (ex.: "Comprou" × "Não comprou"). Simétrico: uma linha por par, `tagId` < `otherId`, cascade nas duas pontas. Marcar uma tag (chat, `PATCH /conversations/:id/tags`, tags do contato, mover card no Kanban, ação "adicionar tag" do fluxo) tira **só as opostas diretas** dela — nunca em cadeia — e só quando a tag é nova no atendimento (pares que já conviviam antes da configuração ficam). Até 20 opostas por tag. Lógica em `apps/api/src/modules/tags/conflicts.ts`.
- `tags.isKanban` (default `true`) faz da tag uma coluna do Kanban; `tags.position` é a ordem da coluna (tag nova entra no fim).
- **Encerramento** (migração `20261120`):
  - **Motivo** (`close_reasons`: nome, cor, `outcome` won/lost/both, ordem, `isActive`) é a lista da empresa, separada das tags. Obrigatório ao encerrar quando há motivo ativo para o resultado (`CloseReasonsService.resolve`, erro `close_reason_required`). Excluir = desativar. A migração criou os motivos a partir das tags que apareciam no encerramento (e tirou delas a marca, para o modal não repetir o nome) e dos motivos antigos em texto (inativos, só histórico), e ligou os encerramentos antigos ao motivo.
  - **Tags transitórias**: as da conversa (`conversation_tags`, inclusive a etapa do Kanban) são do atendimento. Ao encerrar vão para o evento `closed` (`tagSnapshot`, `stageTagId` = etapa) e **saem da conversa** — nada fica "Em negociação" depois de concluído. Permanentes são as do contato (`contact_tags`, 📌).
  - Evento `closed`: `closeReasonId` + `reason` (nome congelado), `tagIds` (escolhidas no modal), `tagSnapshot`, `stageTagId`.
  - Conversa: `lastClosedAt`, `lastCloseOutcome`, `lastCloseReasonId` — o último encerramento, que **sobrevive à reabertura** (topo da conversa, aba Encerrado, filtro em todas as abas).
  - **Carência** (`reopen.ts`, `CLOSE_GRACE_MS` = 2 h): confirmação do cliente ("ok", "obrigada", figurinha — `ehConfirmacao`) e mensagem da loja pelo celular logo depois de encerrar entram no histórico **sem reabrir** (e sem automação). Pergunta, áudio, foto reabrem. Com fluxo esperando resposta (pesquisa), a regra não vale. Eco atrasado do que o painel enviou é reconhecido (mesmo texto, sem `externalId`) e não vira mensagem "do celular".
- <a id="encerramento-interno"></a>**Encerramento interno** (migração `20261122000000_close_internal_audit`): atendimento com a diretoria, teste, erro de envio — não pode pesar no desempenho da equipe.
  - `close_reasons.ignoreInReports` = motivo interno: só aparece no encerramento interno (e o normal recusa esse motivo — `CloseReasonsService.resolve`). `close_reasons.requiresTag` = recusa encerrar (`close_reason_requires_tag`) sem nenhuma tag no atendimento (da conversa ou escolhida no modal). "Comprou" continua sendo o resultado que conta como venda (`won`).
  - Encerrar como interno (`internal: true` em `PATCH /conversations/:id/status` e `POST /conversations/bulk/close`) exige a permissão `conversations.close_internal` (padrão: Administrador e Gerente). Resultado vira `none`, sem venda, sem fluxo padrão. O evento `closed` grava `ignoreInReports = true` (**congelado**: mudar o motivo depois não reescreve o mês fechado).
  - **Relatórios ignoram o atendimento inteiro**: o encerramento (encerrados, por atendente, por motivo, comprou/não comprou, conversão, auditoria `/reports/attendances`) e também o início — o atendimento iniciado (conversa nova ou reaberta) cujo primeiro encerramento seguinte é interno sai do volume e do TMR (`encerradoInterno` em `reports.module.ts`). Contagens de mensagens recebidas/enviadas continuam. Não existe métrica de TMA hoje.
  - **`audit_logs`**: uma linha por conversa encerrada como interna (`action = conversation.closed_internal`): quem (`actorId` + `actorName` copiado), quando, contato (`contactId` + `contactName` copiado) e `data` (`reason`, `closeReasonId`, `bulk`). Só INSERT — nenhuma rota altera ou apaga. Leitura: `GET /audit-logs` com `profiles.manage`.
- <a id="encerramento-sem-venda"></a>`tenant_settings.salesEnabled` (default `true`): encerramento **com venda**. Desligado (empresa de atendimento — condomínio, suporte, serviço público), o resultado continua obrigatório (os nomes viram "Resolvido"/"Não resolvido" se estavam no padrão), mas valor, itens, produtos e observação são descartados no `PATCH /conversations/:id/status`, no "Encerrar conversa" do fluxo e não aparecem no modal — nada grava em `sales`; o encerramento em massa passa a aceitar o resultado positivo.
- `tenant_settings.requireSignature` (default `false`): assinatura do atendente obrigatória. O botão de assinar do chat fica travado ligado e `ConversationsService.send` acrescenta `*Nome:*` na 1ª linha do texto que chegar sem (`signText`); template, encaminhada e Pix saem intactos.
- `tenant_settings.requireSaleValue` (default `true`): "Comprou" exige valor; desligado, encerra sem valor (conta na conversão, sem linha em `sales`). Orçamento pago no atendimento já conta como valor.
- `tenant_settings.requireReasonOnWon` / `requireReasonOnLost` (default `true`, migração `20261205000000_budget_sale_refund`): motivo obrigatório em cada resultado, separados — desligado, o motivo fica opcional naquele resultado (`CloseReasonsService.resolve`).
- `sales.budgetId` (único) = venda que nasceu do pagamento de um orçamento; `sales.refundedAt` = estornada (fora do faturamento, a linha fica). `budgets.closeEventId` = encerramento que absorveu o pagamento; `budgets.status` ganhou `REFUNDED` (`refundedAt`). A migração criou a venda dos orçamentos que já estavam pagos.
- `tenant_settings.wonLabel` / `lostLabel` (default "Comprou" / "Não comprou"): nome dos dois resultados na empresa ("Fechou venda", "Matriculado", "Perdido"…). Só o rótulo muda — o enum continua `won`/`lost` e o comportamento (venda, conversão, fluxo padrão por desfecho, filtros) é o mesmo. Vazio volta ao padrão. Não há resultados além desses dois.
- `tenant_settings.transferMessageEnabled` (default `false`) / `transferMessageText` / `departmentTransferMessageText` (null = os padrões de `conversations/transfer-message.ts`; migração `20261220020000_transfer_message_contacts_io`): mensagem automática ao cliente quando o atendimento é transferido para uma pessoa (`{{atendente}}`, primeiro nome) ou para um departamento (`{{departamento}}`). Variável sem valor = não manda.
- `tags.showOnWon` / `tags.showOnLost` (default `false`) põem a tag na escolha do encerramento como **Comprou** / **Não comprou** — listas separadas (o que explica uma venda não é o que explica uma perda). Vieram de `showOnClose` (migração `20261117`): quem estava marcado continua aparecendo **nos dois** — antes a mesma lista valia para Comprou e Não comprou, então ninguém precisa reconfigurar; o cliente tira de um deles se quiser. O cliente novo nasce com as tags do modelo de perfil, com cor, `isKanban`, `showOnWon` e `showOnLost` ([20](20-modelos-de-perfil.md)); modelo sem `tags` = as de encerramento, nos dois.
- `conversation_tags.isPrimary` marca a **tag principal** = etapa do atendimento no Kanban. No máximo uma por conversa, garantido em `ConversationsService.setPrimaryTag`/`setTags` com `SELECT … FOR UPDATE` na conversa (sem índice parcial: o Prisma 6 não o modela e o `migrate dev` seguinte o apagaria). Só tag com `isKanban` pode ser principal; desmarcar `isKanban` rebaixa as principais dela.

**quick_reply_folders** / **quick_replies** — painel direito. `position` para ordenação manual (arrastar na tela `/respostas`); item novo entra no fim (`max + 1`). A listagem ordena por `position` e o chat (painel e menu `/`) herda essa ordem.

### Cobrança

**plans** — `limits` jsonb (`PlanLimits`). `billingModel` informativo (`fixed | usage | hybrid`). `stripePriceId` (`price_…`) criado por `pnpm stripe:sync` (só `monthly`/`yearly`). `billingCycle` (`free | monthly | yearly | custom`), `isFree` (= `billingCycle = free`), `durationDays` (dias de gratuidade; null = permanente), `priceYear` (anual; `priceMonth` vira o equivalente mensal). Ver docs/05.

**subscriptions** — 1:1 com tenant. `status`: `trialing | active | past_due | suspended | canceled`. `externalId` = id da assinatura no gateway, e `gateway` (`stripe | asaas | null`) diz qual — null = sem cobrança online (atribuída pelo dono). `currentPeriodEnd` = próximo vencimento. `cancelAtPeriodEnd`; `graceUntil`. `units` = unidades cobradas (empresas ativas no grupo consolidado — `tenants.billingType`; 1 fora dele); valor do ciclo = `priceMonth × units`. `invoices.items` guarda o que uma cobrança consolidada do painel de vencimentos quita.

**plan_overrides** — personalização do plano por cliente (1:1 com tenant): `planId` (só vale nesse plano), `priceMonth` (null = preço do plano), `limits` jsonb (`PlanLimitsOverride`: só as chaves presentes sobrescrevem), `expiresAt` (null = sem data), `endedAt` (job já devolveu o valor do plano), `notes`, `promotionId` (nasceu de uma promoção).

**promotions** — promoção de entrada: `discountPercent`, `durationMonths`, `planIds` (text[]), janela `startsAt`–`endsAt`, `isActive`. Vira `plan_overrides` ao assinar. Ver [05](05-planos-e-cobranca.md#promoções).

**discount_grants** — livro de descontos (contabilidade): uma linha permanente por concessão (`kind`: `promotion | negotiated`; `source`: `checkout | tenant_create | manual | bulk | plan_return`), com cópia de nomes, `listPrice`, `priceMonth`, `discountPercent`, `units`, `startsAt`, `endsAt`, `closedAt`, `grantedById/Name`. FKs `SET NULL`: apagar cliente/plano/promoção não apaga o registro. Ver [05](05-planos-e-cobranca.md#livro-de-descontos). Ver [05](05-planos-e-cobranca.md#personalização-por-cliente).

**provider_pricing** — histórico de preços por `(provider, country, category)`; sempre inserir, nunca editar.

**message_usage** — ledger, uma linha por mensagem. Ver [05](05-planos-e-cobranca.md).

**ai_usage** — ledger de IA, uma linha por chamada ao modelo (`kind`, modelo, tokens de
entrada e saída, custo em USD e BRL calculado na hora, latência, e `error` quando falhou).
É o que permite saber a margem da IA e aplicar o teto de gasto. Ver [15](15-ia.md).

**usage_counters** — agregado mensal reconciliado (`tenantId + period` únicos).

**usage_alerts** — quais alertas já disparamos (única por tenant/período/métrica/threshold).

**invoices** — espelho da fatura do Stripe (`in_…`) ou da cobrança do Asaas (`pay_…`; excedente vira cobrança avulsa com `baseAmount = 0`): base + excedente, `externalId`, `hostedUrl` (link de pagamento). Única por tenant/período.

### Relatórios

**sales** — uma linha por atendimento encerrado como **Comprou**: `conversationId`, `contactId`,
`userId` (quem encerrou; nulo = super_admin), `amount` (obrigatório), `products`, `items`, `notes`,
`closedAt`. `items` (JSONB, `[{description, value}]`) vem da venda em lista: aí `amount` é a soma
calculada pela API e `products` é o resumo das descrições; nulo = encerrada em texto livre
(migração `20261029000100_sale_items`). Nunca alterada nem apagada — reabrir a conversa limpa `conversations.outcome*`, mas a
venda que já entrou no mês continua. É a base de conversão, ticket médio e faturamento por
atendente (índices por `tenantId + closedAt` e `tenantId + userId + closedAt`). *Comprou* exige valor
(> 0) e não existe no encerramento em massa (400) — toda venda tem valor. Migração `20261028000000_close_flows_and_sales`.

**sales_goals** — meta mensal de vendas por consultor (`month` "AAAA-MM", `userId` ou `'*'` = padrão, `revenueTarget`, `wonTarget`). Ver [metas.md](metas.md). Migração `20261130000000_sales_goals`.

**satisfaction_surveys** / **survey_responses** — pesquisa de satisfação no encerramento: a configuração (escala, pergunta, recusa, comentário, prazo, `isDefault`) e uma resposta por envio, com status (`pending → commenting → answered`, `declined`, `expired`, `failed`), nota, comentário e consultor/escala congelados. Detalhes em [pesquisa-de-satisfacao.md](pesquisa-de-satisfacao.md). Migração `20261127000000_satisfaction_surveys`.

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
| BillingType | INDIVIDUAL, CONSOLIDATED_GROUP (em `tenants` e `companies` — [empresas.md#cobrança](empresas.md#cobrança)) |
| WorkScheduleType | FIXED_12X36, COMMERCIAL_44H, CUSTOM ([escalas.md](escalas.md)) |
| SupportTicketStatus | open, in_progress, resolved ([chat-interno.md#fila-de-suporte](chat-interno.md#fila-de-suporte)) |
| AccessRequestStatus | pending, approved, denied ([escalas.md#pedido-de-autorização](escalas.md#pedido-de-autorização)) |

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
horários) + `attendanceChangedAt`, fluxos padrão (inclusive `wonFlowId`/`lostFlowId`,
o fluxo de encerramento por resultado) e **boas-vindas** (`welcomeEnabled`,
`welcomeMessages`, `welcomeMode`, `welcomeCursor`); `quickReplyDelaySec` foi removido (a resposta rápida sai na hora — [Envio](envio.md#respostas-rápidas)). `lossReasons`, `lossReasonColors` e `noneFlowId` saíram na migração `20261114000000_close_reasons_to_tags`: motivo de perda virou **tag** (cada motivo de cada cliente virou uma tag fora do Kanban, com a cor que tinha) e "Sem resultado" deixou de ser escolha no encerramento. Cliente criado por `POST /tenants` nasce com as tags de `DEFAULT_LOSS_REASONS` (`packages/shared/src/loss-reasons.ts`) ou as do modelo de perfil.

**business_schedules** — quadros de horários ([Horários](horarios.md)): `name`, `timezone`,
`isDefault` (um por cliente) e `config` (JSON `ScheduleConfig`: faixas, Fechado, grade semanal,
exceções por data). `whatsapp_numbers.scheduleId` = quadro próprio do número (nulo = padrão).
Cliente sem quadro = sempre aberto. `conversations.scheduleNoticeKey` = período da faixa cuja
resposta já foi enviada (uma vez por conversa a cada período). Substituiu `business_hours` e
`outsideHoursText` (migração `20261005000000_business_schedules`).


**contacts.nameSource** (`whatsapp` | `agenda` | `manual`) diz de onde veio o nome e quem pode trocá-lo — ver [providers › De onde vem o nome do contato](04-providers-whatsapp.md#de-onde-vem-o-nome-do-contato-contactsnamesource).

**contacts** ganhou a ficha preenchida pelo atendente: `email`, `address`, `note1` e
`note2`. Campo enviado vazio vira `null` — o atendente apaga o que não vale mais. `document` = CPF (11) ou CNPJ (14), só dígitos (tamanho errado = 400), usado no Pix automático do orçamento ([orcamentos.md](orcamentos.md#pix-automático)); também é gravado quando o atendente digita o CPF no modal do orçamento.

**contact_attributes** — campos livres da ficha de **um** contato (`label`, `type`
`ContactAttributeType`: text, number, date, `value` em texto, `position`). Cada cliente tem os
seus; não há cadastro de campos da empresa. Ver [Campos personalizados](campos-personalizados.md).

**pix_keys** — chaves Pix da empresa (`title`, `keyType` em `PIX_KEY_TYPES`, `key` normalizada pelo tipo, `holderName`, `position`). Enviadas pelo painel do chat como cartão "Copiar chave Pix" (até 30 por empresa).

**budgets** — orçamento/pedido gerado no chat, visto pelo contato na página pública `/o/:hash` (`hash` único, `items` jsonb, `totalValue`, cópia da chave Pix, `paymentUrl`, `status` `PENDING`/`PAID`/`EXPIRED`, `expiresAt`, comprovante em `receiptKey`). Ver [Orçamentos](orcamentos.md).

**secure_media** — foto protegida: mídia do chat atrás de um link com validade (`/f/:hash`, `hash` único, `mediaKey`, `caption` só na página, `validHours`, `expiresAt`, `revokedAt`, `viewCount`/`firstViewedAt`). Pelo WhatsApp vai só o texto com o link. Ver [Foto protegida](foto-protegida.md).

**payment_gateways** — conta do Asaas da empresa para o Pix automático do orçamento (chave criptografada, `sandbox`, segredo e id do webhook, nome da conta). Uma por empresa. Ver [Orçamentos → Pix automático](orcamentos.md#pix-automático).

**global_variables** — variáveis da empresa (`key` única por tenant, minúsculas/números/`_`; `label`; `value`). Entram no envio como `{{global.<key>}}` e `{{<key>}}`. Ver [Variáveis](variaveis.md).

**scheduled_messages** — mensagem que o atendente agendou na conversa (`userId` = autor, `content`, anexo opcional por `mediaKey`, `scheduledFor`, `status` `ScheduledMessageStatus`: pending, sent, cancelled, failed + `error`, `messageId`). Job de 1 minuto envia pelo caminho do chat. Ver [Agendamento de mensagens](agendamento-de-mensagens.md).

**phonebook_entries** — agenda do celular de cada número (`numberId`, `phone`, `name`, `previousName` = nome antes da última troca, único por número + telefone), vinda da sincronização de contatos da Evolution. **Não é contato** e não aparece no painel; serve para o contato nascer com o nome da agenda. Cai junto com o número (cascade). `searchText` (também em **contacts**) é coluna **gerada** no banco só para a [busca textual](07-api.md#busca-textual-de-contatos), com índice GIN `pg_trgm`; o `PrismaService` a omite das respostas. Ver [providers › De onde vem o nome do contato](04-providers-whatsapp.md#de-onde-vem-o-nome-do-contato-contactsnamesource).

**contacts.optOutAt / waInvalidAt** — descadastro de todo envio automático e telefone que a checagem disse não ter WhatsApp ([Envio](envio.md#descadastro)). **whatsapp_numbers.sessionStartedAt** — QR lido, base do aquecimento de 72 h; `waRemovedAt`/`waRemovedCount`/`reconnectBlockedUntil` — queda forçada pelo WhatsApp. Migrações `20261029000600_number_wa_removed` e `20261029000700_warmup_optout`.

**system_notices** — avisos globais do dono (`SystemNotice`): `title`, `message`, `type` (`INFO`/`WARNING`/`CRITICAL`), `active`, `createdAt`. Sem `tenantId` — vale para todos os clientes. Ver [avisos.md](avisos.md).

# 07 — API

Base: `http://localhost:4000`. Todas as rotas (exceto `/auth/*` e `/webhooks/*`) exigem `Authorization: Bearer <accessToken>`.

## Autenticação

```bash
# login → access token no corpo, refresh token em cookie httpOnly
curl -c cookies.txt -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@atendo.local","password":"demo12345"}'
# {"accessToken":"eyJ..."}

# renovar (usa o cookie; devolve novo par e revoga o refresh antigo)
curl -b cookies.txt -c cookies.txt -X POST localhost:4000/auth/refresh

# quem sou
curl localhost:4000/auth/me -H "Authorization: Bearer $TOKEN"

# sair
curl -b cookies.txt -X POST localhost:4000/auth/logout
```

Access token expira em 15 min (`JWT_ACCESS_TTL`). O front renova sozinho em 401 (`apps/web/src/lib/api.ts`).

## Rotas

| Método | Rota | Role | Descrição |
|---|---|---|---|
| **Tenants** | | | |
| GET | `/tenants` | super_admin | Lista clientes com plano e contagens |
| POST | `/tenants` | super_admin | Cria cliente + assinatura + admin. Plano gratuito nasce `active`; pago, `trialing` |
| PATCH | `/tenants/:id` | super_admin | `name`, `isActive`, `planId`, `subscriptionStatus` (ajuste manual sem Stripe). Trocar para plano gratuito: assinatura `active`, preço 0, e a assinatura paga no Stripe (se houver) é cancelada |
| GET | `/notices/active` | todos (inclusive dono) | Avisos globais ativos, mais novos primeiro (até 30) — ver [avisos.md](avisos.md) |
| GET | `/super-admin/notices` | super_admin | Todos os avisos (ativos e desativados) |
| POST | `/super-admin/notices` | super_admin | `{title, message, type?: INFO \| WARNING \| CRITICAL}` — grava e emite `system_notice` para todos os conectados |
| PATCH | `/super-admin/notices/:id` | super_admin | `{active}` — desativar tira do sino de todos |
| POST | `/tenants/:id/impersonate` | super_admin | `{accessToken, tenant}` — "entrar como" (token com o tenant, papel admin, `impersonatorId`) |
| GET | `/tenants/me/agents` | todos | Atendentes do meu tenant (todos podem listar para transferir) |
| POST | `/tenants/me/agents` | tenant_admin, manager | Cria atendente (`role: agent`) ou gerente (`role: manager`, só admin); respeita `maxAgents` |
| PATCH | `/tenants/me/agents/:id` | tenant_admin | Nome / ativo / `password` (redefine e revoga sessões) |
| **Números** | | | |
| GET | `/numbers` | todos | Números do tenant. `warmup` = fase do aquecimento (`{phase, newConvPerHour, minGapMs, endsAt}` ou `null`, ver [Envio](envio.md#aquecimento)) |
| GET | `/numbers/:id/phonebook?q=&cursor=` | quem opera o número | Agenda do celular do número (sincronizada da Evolution), alfabética, 50 por página: `{ items: [{id, phone, name, contactId}], nextCursor, total? }` (`total` só na 1ª página). `q` filtra por nome ou telefone — [busca textual](#busca-textual-de-contatos). `contactId` preenchido = a pessoa já é contato |
| POST | `/numbers/:id/contacts/sync` | `numbers.manage` | Relê agora a agenda de contatos do celular (só Evolution conectado; senão 400). Entra na fila do worker — devolve `{ queued: true }`. Também roda sozinho a cada 6 h ([Providers](04-providers-whatsapp.md)) |
| GET | `/numbers/:id/templates?refresh=1` | quem opera o número | Templates **aprovados** (HSM) da WABA do número, normalizados em `MessageTemplate` (`@atendo/shared`): nome, idioma, categoria, cabeçalho/corpo/rodapé, botões e variáveis (`headerParams`, `bodyParams` — `1`, `2`… ou nomes). Cache de 5 min por número no processo da API; `refresh=1` busca de novo na Meta. Evolution = `[]`. O que o painel ainda não preenche (cabeçalho de mídia, botão com URL dinâmica, autenticação) vem com `unsupported` (motivo) |
| POST | `/numbers` | tenant_admin | Cria e conecta (respeita `maxNumbers`) |
| PUT | `/numbers/:id/provider` | tenant_admin | **Troca de provider** |
| POST | `/numbers/:id/connect` | tenant_admin | Reconecta / QR novo. `{force?}`: durante a pausa após o WhatsApp derrubar o número responde 409 `reconnect_paused` (`until`, `removedCount`); `force: true` reconecta mesmo assim — ver [providers](04-providers-whatsapp.md#quando-o-whatsapp-derruba-o-número-401-device_removed). `GET /numbers` traz `waRemovedAt`, `waRemovedCount`, `reconnectBlockedUntil` |
| PATCH | `/numbers/:id` | tenant_admin | Label / cor (`color`, `#rrggbb`) / ativo / `sendDelay` / `sendLimits` (`sendDailyLimit` e `endWarmup` ainda são aceitos, mas a tela não usa mais — teto diário desligado) |
| POST | `/numbers/:id/disconnect` | `numbers.manage` | Encerra a sessão (logout na Evolution) sem excluir; número e conversas ficam, status `disconnected` |
| DELETE | `/numbers/:id` | tenant_admin | Exclui = tira do provider e **arquiva** (`deletedAt`): conversas ficam guardadas, fora da lista. `POST /numbers` com o mesmo telefone na mesma conta revive o número com o histórico; telefone ativo duplicado → 409 |
| **Conversas** | | | |
| GET | `/conversations?status=&numberId=&departmentId=&tagIds=a,b&search=&origin=&assigneeId=&sort=&cursor=` | todos | Lista por cursor. `departmentId` = id ou `none` (sem departamento), sempre interseccionado com o escopo de departamentos do usuário ([Departamentos](departamentos.md)). Em `in_progress`, atendente vê só as suas; admin vê todas ou filtra por `assigneeId`. `sort=waiting` ordena por quem espera resposta há mais tempo (`awaitingSince` asc, já respondidas por último). `search` = [busca textual](#busca-textual-de-contatos) no nome/e-mail/telefone do contato |
| GET | `/conversations/counts?numberId=&departmentId=` | todos | `{waiting, in_progress, closed, in_progress_mine, in_progress_all}` (`in_progress` já respeita a visão do usuário) |
| GET | `/conversations/:id` | todos | Uma conversa (contato, tags, atendente, número) |
| GET | `/conversations/:id/messages?cursor=` | todos | Mensagens (mais recentes primeiro, 50); `mediaUrl` já vem assinada. **Nada é apagado**: o painel carrega a última página e busca o passado conforme a pessoa rola, com `cursor` = id da última linha recebida |
| POST | `/conversations/:id/messages` | todos | Envia: `{type:'text', text}` ou `{type:'image'|'audio'|'video'|'document', mediaKey, text?}` ou template `{type:'text', template: { name, language, header?, body? }}` — conferido na Meta no número da conversa, valores aceitam `{{contact.first_name}}` etc. (variável vazia = 400; número Evolution = 400). É como o composer retoma a conversa com a janela de 24h fechada. Sai **sempre** pelo número da conversa (nenhum campo escolhe o número; campo extra = 400). `expectedNumberId?` = canal mostrado na tela: divergiu → 409 `{code:'number_changed'}` sem enviar. Número inativo/de outro tenant ou desconectado → 422. Contato frio (não escreveu neste número em 24 h): Evolution → 409 `{code:'cold_send_unofficial'}`; Meta sem o recurso `proactive_messaging` → 403 `{code:'feature_proactive'}` ([Envio frio](envio.md#envio-frio)); o mesmo vale para `POST /conversations/start`. `idempotencyKey?` (até 100 caracteres, uma por envio): repetir com a mesma chave devolve a mensagem já criada, sem enfileirar de novo ([Envio](envio.md#deduplicação)). `quotedExternalId?` = id no provider da mensagem respondida (citação, ver [Providers](04-providers-whatsapp.md)). Texto com `{{...}}` (resposta rápida, `{{saudacao}}`, campos da ficha) é resolvido aqui — chave desconhecida fica como escrita ([Variáveis](variaveis.md)) |
| GET | `/conversations/start/contacts?q=` | todos | Busca do *Nova conversa* (≥ 2 caracteres, [busca textual](#busca-textual-de-contatos)): `{ contacts: [{id, name, phone, avatarUrl}], phonebook: [{phone, name, numberId}] }` — até 8 contatos da base e até 8 nomes da agenda do celular (Evolution) que ainda não são contato. Usuário restrito a números/departamentos só vê contato que já conversou por eles e só a agenda dos números que opera |
| POST | `/conversations/start` | todos | **Iniciar conversa** (disparo ativo). `{ numberId, contactId? \| phone?, name?, text? \| template?: { name, language, header?: {"1": "…"}, body?: {…} }, idempotencyKey? }`. Contato por id ou telefone (DDI+DDD+número; reaproveita o contato existente, com ou sem o nono dígito, senão cria com `name` manual). Uma conversa por contato+número: existe → usa (encerrada é reaberta como atendimento de quem iniciou); não existe → cria. Depois é um `send` normal (posse, quota, ledger, fila com o ritmo do número). Meta: sem template só dentro da janela de 24h (400); template é conferido na Meta e os valores aceitam `{{contact.first_name}}` etc. (variável vazia = 400). Evolution + template = 400. Número fora do escopo do usuário = 403; desconectado = 422; conversa aberta de outro atendente = 409 `{code:'already_assigned', conversationId}`; em departamento que o usuário não vê = 409 `{code:'other_department'}`. Devolve `{ conversationId, message }` |
| POST | `/conversations/:id/notes` | `conversations.internal_note` | Nota interna `{ text }` (1–4096, vazio/só espaços = 400). Grava `internal: true`, `status: delivered`, `authorId` + `authorName`; **nunca** entra na fila de envio e não passa pelo `UsageService`. Não assume a conversa — vale também em conversa de outra pessoa ou encerrada. Emite `message` no socket |
| POST | `/conversations/:id/claim` | todos | Assumir (atômico; 409 se outra pessoa assumiu) |
| POST | `/conversations/:id/transfer` | dono ou admin | `{agentId}` |
| POST | `/conversations/:id/release` | dono ou admin | Devolve à fila (waiting, sem dono) |
| PATCH | `/conversations/:id/department` | dono, `transfer_any` ou qualquer um se sem dono | `{departmentId: uuid \| null}` — vai para a fila (Aguardando, sem dono) do departamento; encerrada só troca. Grava `department_changed` |
| POST | `/conversations/:id/messages/:messageId/resend` | todos | "Tentar novamente": mensagem `failed` volta para `pending` no fim da fila da conversa. 409 se já foi reenviada (clique duplo) ou se a conversa mudou de canal (`number_changed`); número desconectado → 400 |
| POST | `/conversations/:id/messages/:messageId/react` | todos | Reação do atendente `{ emoji }` (vazio = retirar). Manda pelo provider e **só grava se ele aceitar**; emite `message` no socket. Recusa: mensagem sem `externalId`/pendente/falha, conversa encerrada, número desconectado, conversa de outro atendente (409), fora da janela de 24h (Meta). Não assume a conversa e não passa pelo `UsageService` |
| DELETE | `/conversations/:id/messages/:messageId` | própria recente: todos; demais: `conversations.delete_message` | Apaga a mensagem ([regras](apagar-mensagens.md)). Enviada por nós, < 48h, número conectado: pede "apagar para todos" ao provider (Evolution); Meta/prazo/recusa/recebida = só no painel. Pendente = cancela o envio. Nunca remove a linha: grava `deletedAt/deletedById/deletedByName/deletedForEveryone` + evento `message_deleted`. Devolve `{ message, forEveryone, notice }` (`notice` = por que foi só no painel). Emite `message` (já sem conteúdo) e `conversation`. Já apagada = 409 |
| PATCH | `/conversations/:id/messages/:messageId` | `conversations.edit_message` | Edita uma mensagem de texto enviada pelo número `{ text }` — de qualquer origem (própria, de colega, do celular, da automação); recebida e nota interna = 400. Na fila: troca só o texto. Enviada: edita no provider (Evolution, ≤ 15 min) e só grava se ele aceitar; Meta = 422; prazo/falha = 409. Grava `editedAt` + evento `message_edited` (texto anterior). Ver [Editar mensagens](editar-mensagens.md) |
| GET | `/conversations/:id/messages/:messageId/original` | `conversations.view_deleted` | Conteúdo original de uma apagada (`DeletedMessageOriginal`, mídia em URL assinada) |
| DELETE | `/conversations/:id/messages` | `conversations.delete_chat` | Limpa o histórico: todas as mensagens apagadas só no painel, pendentes canceladas, evento `history_cleared`. Devolve `{ cleared, cancelled }`. Emite `messages_cleared` e `conversation`. Sem mensagens = 400 |
| POST | `/conversations/:id/messages/:messageId/forward` | todos | Encaminhar `{ targetConversationIds: uuid[] }` (1–5). Cada destino é um `send` normal marcado `forwarded: true` (quota, janela da Meta, "responder = assumir", ledger). Mídia reaproveita o arquivo do storage; localização vira texto com link do Maps, contato vira nome + telefone, botões/lista viram o texto. Recusa figurinha e mídia ainda não baixada. Destino fora do escopo de números do usuário = "não encontrada". Devolve `{ sent: Message[], failed: { conversationId, error }[] }` — falha num destino não derruba os outros |
| GET | `/conversations/:id/scheduled-messages` | todos | Mensagens agendadas `pending`/`failed` da conversa ([Agendamento de mensagens](agendamento-de-mensagens.md)) |
| POST | `/conversations/:id/scheduled-messages` | `conversations.schedule_message` | Agenda `{content, scheduledFor (ISO), mediaKey?, mediaType?, mediaName?, mediaMime?}`. ≥ 1 min à frente, ≤ 365 dias; conversa de outra pessoa = 409; Meta fora da janela de 24h = 400. Socket `scheduled_messages` |
| DELETE | `/conversations/:id/scheduled-messages/:scheduledId` | `conversations.schedule_message` | Cancela pendente / dispensa falhada (já enviada = 404) |
| PATCH | `/conversations/:id/status` | todos | `{status: waiting \| in_progress \| closed, outcome?, value?, reason?, products?, items?, notes?, flowId?}`. No encerramento `won`, `value` > 0 grava uma linha em `sales` com `products`/`notes`; sem valor fica só o desfecho (sem venda). Com `items` (`[{description?, value}]`, até 50 — descrição opcional) o total é a soma dos itens — `value` enviado é ignorado e o resumo `products` vira as descrições preenchidas. `flowId` ausente = fluxo padrão do resultado (`wonFlowId`…) ou o geral (`onCloseFlowId`); `null` = nenhum |
| POST | `/conversations/bulk/close` | todos | `{ids[], outcome?, reason?}` — encerra até 200. Devolve `{closed, ignored}`. O recorte (números do usuário; atendente comum só o que é dele ou está sem dono) é feito no service, porque o `ConversationScopeGuard` olha `:id` e aqui a lista vem no corpo. Sem valor de venda e sem fluxo, de propósito |
| GET | `/conversations/:id/events` | todos | Histórico do atendimento: `claimed`, `transferred`, `released`, `closed`, `reopened`, `bot_paused`, `bot_resumed`, `department_changed` (`reason` "A → B"), com ator, alvo, desfecho congelado e data |
| POST | `/conversations/:id/bot/pause` | todos (feature `flows`) | Pausa o robô só nesta conversa. Body `{ minutes?: 30 \| 60 \| 240 \| null }` (nulo = até retomar). Interrompe o fluxo em andamento. Ver [fluxos › Pausar o robô](fluxos.md#pausar-o-robô-na-conversa) |
| POST | `/conversations/:id/bot/resume` | todos (feature `flows`) | Retoma o robô (o fluxo interrompido não volta) |
| PATCH | `/conversations/:id/tags` | todos | `{tagIds: []}` substitui as tags. A principal se mantém se continuar na lista; senão a primeira tag de coluna (ordem do Kanban) assume. Emite `conversation` |
| PATCH | `/conversations/:id/primary-tag` | todos | `{tagId: uuid \| null}` troca a tag principal (mover card no Kanban). A antiga vira secundária; a nova entra se faltava. `null` = "Sem etapa". 400 se a tag não for `isKanban`. Emite `conversation` |
| PATCH | `/conversations/contacts/:contactId` | `contacts.edit` | Ficha (`name`, `email`, `address`, `note1`, `note2`) e `resubscribe: true` = volta a receber mensagens automáticas (limpa `optOutAt`, [Descadastro](envio.md#descadastro)) |
| PATCH | `/conversations/contacts/:contactId/tags` | todos | `{tagIds}` substitui as tags **do contato** (permanentes) |
| **Campos livres da ficha (por contato)** | | | |
| GET | `/contact-attributes/labels` | todos | Nomes já usados na empresa (`{label, type}`), mais usados primeiro — sugestão ao digitar |
| GET | `/contact-attributes/:contactId` | todos | Campos do contato, na ordem: `{id, label, type: text\|number\|date, value}[]` |
| GET | `/tenants/me/global-variables` | todos | Variáveis da empresa: `{id, key, label, value, updatedAt}[]`, por nome |
| POST | `/tenants/me/global-variables` | `variables.manage` ou `flows.manage` | `{label, key?, value}` — sem `key`, gerada do nome ("Chave PIX" → `chave_pix`). Chave inválida/reservada (`empresa`, `saudacao`…) = 400; repetida = 409; até 200 por empresa |
| PUT | `/tenants/me/global-variables/:id` | `variables.manage` | `{label?, key?, value?}` (trocar a chave quebra os textos que usam a antiga) |
| DELETE | `/tenants/me/global-variables/:id` | `variables.manage` | Remove |
| PUT | `/contact-attributes/:contactId` | `contacts.edit` | `{items: {label, type, value}[]}` (até 50) **substitui** a lista. Linha toda em branco é ignorada; nome sem valor (ou o contrário), número/data inválidos e nome repetido = 400 |
| POST | `/conversations/:id/read` | todos | Zera não-lidas. Também assina o "digitando…" do contato no provider (Evolution; no máx. 1×/2 min por contato, sem esperar a resposta) |
| POST | `/conversations/:id/typing` | todos | `{state?: 'composing'\|'paused'}` (padrão `composing`). Atendente digitando → "digitando…" no WhatsApp do contato enquanto o painel renovar (a cada ~2 s; expira em 4 s sem renovação); `paused` apaga na hora. Só Evolution conectada e conversa aberta. 204, nunca falha |
| **Departamentos** | | | |
| GET | `/departments` | todos | Com participantes e nº de conversas abertas |
| POST / PATCH / DELETE | `/departments[/:id]` | `team.manage` | `{name, description?, color?, isActive?, userIds?}` (`userIds` substitui). Excluir deixa as conversas sem departamento. Ver [Departamentos](departamentos.md) |
| **Empresas / unidades** | | | Toda rota aceita o header `x-company-id` (empresa do seletor): vira escopo de números. Ver [Empresas](empresas.md) |
| GET | `/companies` | todos | Empresas do cliente com números e pessoas vinculadas |
| GET | `/companies/mine` | todos | Empresas que o usuário pode escolher no seletor (`[]` = cliente sem empresas) |
| POST / PATCH / DELETE | `/companies[/:id]` | `settings.manage` | `{name, cnpj?, description?, numberIds?, userIds?}` (listas substituem; marcar um número tira ele da outra empresa). `POST` checa `maxCompanies` do plano. Excluir deixa os números sem empresa |
| GET | `/admin/tenants/:tenantId/companies` | super_admin | Empresas do cliente (mesmo formato de `GET /companies`) |
| GET | `/admin/tenants/:tenantId/companies/options` | super_admin | `{numbers[{id,label,phone}], users[{id,name,isActive}], maxCompanies}` para o formulário |
| POST / PATCH / DELETE | `/admin/tenants/:tenantId/companies[/:id]` | super_admin | Mesmo corpo de `/companies`. **Sem** o limite `maxCompanies` do plano (exceção do dono) |
| **Tags** | | | |
| GET | `/tags` | todos | Com contagem de conversas |
| POST / PATCH / DELETE | `/tags[/:id]` | `tags.manage` | `{name, color, isKanban?, position?}`. Lista vem na ordem do Kanban (`position`, nome). Emite `kanban` |
| **Kanban** | | | |
| GET | `/kanban?numberId=` | todos | `KanbanBoard` (`packages/shared/src/kanban.ts`): colunas (tags `isKanban`) + cards dos atendimentos abertos que a pessoa enxerga (mesma regra de posse/número da lista). Até 500, mais recentes primeiro (`truncated`) |
| PATCH | `/kanban/columns` | `tags.manage` | `{tagIds}` nova ordem das colunas. Emite `kanban` |
| **Respostas rápidas** | | | |
| GET | `/quick-replies` | todos | Pastas com respostas |
| POST / PATCH / DELETE | `/quick-replies/folders[/:id]` | todos | Pastas |
| POST / PATCH / DELETE | `/quick-replies[/:id]` | todos | Respostas |
| PATCH | `/quick-replies/folders/reorder` | `quick_replies.manage` | `{ items: [{ id, position }] }` — ordem das pastas |
| PATCH | `/quick-replies/reorder` | `quick_replies.manage` | `{ items: [{ id, position, folderId? }] }` — ordem das respostas; `folderId` move para outra pasta (do mesmo tenant) |
| POST | `/quick-replies/duplicate` | `quick_replies.manage` | `{ ids }` → `{ replies }` — cópia na mesma pasta, título com " (cópia)", anexo mantido (mesmo cliente) |
| GET | `/quick-replies/:id/export` | `quick_replies.manage` | `{ portable, warnings }` — `{ atendo: 'quick-reply', version, folder, title, body }`; anexo não vai (chave carrega o tenant), com aviso |
| POST | `/quick-replies/export` | `quick_replies.manage` | `{ ids }` → `{ bundle, warnings }` — `{ atendo: 'quick-reply-bundle', version, items }`, cada item igual ao individual |
| POST | `/quick-replies/import` | `quick_replies.manage` | `{ portable }` (individual ou lote) → `{ replies, warnings }`. Pasta achada pelo nome ou criada; título repetido na pasta ganha " (cópia)"; tudo ou nada (transação) |
| **Configurações** | | | |
| GET / PATCH | `/settings` | todos / `settings.manage` | Fuso, `attendanceActive`, fluxos padrão, boas-vindas (`welcomeEnabled`, `welcomeMessages`, `welcomeMode`), `lossReasons` (até 30; vazios e repetidos são descartados). GET traz `isOpenNow`, `currentBand`, `nextOpenLabel` |
| GET / POST | `/settings/schedules` | todos / `settings.manage` | Quadros de horários. POST `{ name, timezone?, config?, copyFromId? }` |
| PUT / DELETE | `/settings/schedules/:id` | `settings.manage` | `{ name?, timezone?, config? }` validado (`validateSchedule`); devolve `renamedConditions` (faixa renomeada atualiza as condições dos fluxos); o padrão não pode ser excluído |
| POST | `/settings/schedules/:id/default` | `settings.manage` | Torna o quadro padrão |
| PUT | `/settings/numbers/:numberId/schedule` | `settings.manage` | `{ scheduleId \| null }` — quadro próprio do número. Ver [Horários](horarios.md#api) |
| **Mídia** | | | |
| POST | `/uploads` | todos | multipart `file` → `{key, url, mimeType, fileName, size}` |
| GET | `/media/*path?exp=&sig=` | — (assinatura) | Serve o arquivo se a assinatura for válida |
| **Billing** | | | |
| GET | `/billing/plans` | todos | Planos ativos com limites, `billingCycle`, `isFree`, `durationDays`, `priceYear` e `stripePriceId`. Cliente só recebe `monthly`/`yearly`; super_admin recebe todos (inclui gratuitos, para atribuir) |
| GET | `/billing/plans/all` | super_admin | Catálogo completo (inclui inativos) com `subscribers` e `billingEnabled` |
| POST | `/billing/plans` | super_admin | Cria plano. `{name, priceMonth, billingModel, limits, isFree?, billingCycle?, durationDays?, priceYear?}` — `limits` validado campo a campo (`maxNumbers/maxAgents/maxFlows/maxQuickReplies/maxCompanies`: `null` = ilimitado). Gratuito zera preço e força `hardLimit`. Cria produto+preço no Stripe quando a cobrança está ligada |
| PATCH | `/billing/plans/:id` | super_admin | Edita. Trocar `billingCycle` com assinantes = 400. Mudar `priceMonth` (ou `priceYear`) cria um preço novo no Stripe e arquiva o antigo (preço é imutável lá). `applyToExisting: {mode: 'never'\|'scheduled'\|'now', days?}` decide o que acontece com quem já assina — padrão `never` |
| DELETE | `/billing/plans/:id` | super_admin | Só sem assinantes (senão 400). Arquiva o produto no Stripe |
| GET | `/billing/invoices` | todos | Faturas do tenant (espelho do Stripe ou das cobranças do Asaas) |
| POST | `/billing/checkout` | tenant_admin | `{planId}` → `{url}` do Checkout (ou troca com proration se já assina). Plano gratuito/personalizado = 400 (só o dono atribui) |
| POST | `/billing/portal` | tenant_admin | `{url}` do Customer Portal |
| GET | `/billing/margin?period=` | super_admin | Margem por cliente |
| GET | `/billing/finance?months=` | super_admin | Financeiro completo: MRR/ARR, ativos/teste/pendentes/suspensos, em atraso, série mensal (faturado, recebido, atrasado, excedente, custo, novos, cancelados), por plano, assinaturas, faturas |
| POST | `/billing/sync-plans` | super_admin | Cria Products/Prices no Stripe |
| GET | `/billing/usage` | todos | Uso do mês (mensagens, templates, números, atendentes, fluxos ativos, respostas rápidas), limites, status, mensalidade, excedente, fim do período, `freePlan: {durationDays} \| null`, `billingCycle`, `gateway` (`asaas\|stripe\|null`, dos checkouts novos) e `subscriptionGateway` (onde a assinatura atual nasceu) |
| GET | `/billing/asaas/customer` | `billing.manage` | Dados do cliente no Asaas (CPF/CNPJ, e-mail, CEP…) para preencher o checkout; `null` se ainda não existe |
| POST | `/billing/asaas/checkout` | `billing.manage` | `{planId, billingType: 'PIX'\|'CREDIT_CARD', customer: {cpfCnpj, name?, email?, mobilePhone?}, card?: {holderName, number, expiryMonth, expiryYear, ccv}, holder?: {name, email, cpfCnpj, postalCode, addressNumber, phone}}` → `{payment}` (cobrança em aberto, com `pix: {encodedImage, payload, expirationDate}` no PIX). Já assina pelo Asaas = troca plano/forma na mesma assinatura. Assinatura viva no Stripe = 400 |
| GET | `/billing/asaas/pending` | `billing.manage` | `{payment}`: cobrança em aberto mais antiga (vencida primeiro), com QR PIX — botão "Pagar" da tela |
| GET | `/billing/asaas/payments/:id?pix=1` | `billing.manage` | Situação da cobrança consultada no Asaas (polling do modal). Paga = aplica o mesmo efeito do webhook. Cobrança de outro cliente = 404 |
| **Relatórios** | | | |
| GET | `/reports/overview?from=&to=` | todos | Visão pronta: KPIs (conversas, fila agora, 1ª resposta média, % encerradas, msgs in/out, comprou/não comprou/taxa de conversão) + séries por dia/atendente/origem/campanha/tag/status + `sales` (tabela `sales`, pelo `closedAt`): `{total, count, avgTicket, byDay[{label,value}], byAgent[{label,value,count,avgTicket}]}` + `lostReasons[{label,value}]` (encerramentos `lost` do período por motivo, de `conversation_events.reason`; sufixo "· encerrado em massa" removido, vazio = "(sem motivo)") |
| GET | `/reports/sales/details?startDate=&endDate=&userId=&contactId=&phone=&customerName=&search=&page=&pageSize=` | `reports.view` | Detalhamento da tabela `sales` (pelo `closedAt`; `endDate` exclusivo, padrão últimos 30 dias). `search` casa nome do cliente, número (dígitos, ≥3) ou produto (`products` e `items[].description`). Paginado (`pageSize` ≤ 100, padrão 25), mais recente primeiro. Retorna `{page, pageSize, total, summary{count, revenue, avgTicket, itemsSold}, agents[{id,name}], rows[{id, closedAt, amount, conversationId, contact{id,name,phone,phoneFormatted}, user{id,name}\|null, items[{description,value}], notes}]}`. Venda em texto livre vem como 1 item (`products` + total) e conta 1 em `itemsSold` |
| POST | `/reports/run` | todos | Executa um `ReportDefinition` |
| GET / POST / DELETE | `/reports/saved[/:id]` | todos | Relatórios salvos |
| **Webhooks** (sem auth de usuário) | | | |
| GET | `/webhooks/meta` | — | Verificação da Meta (`hub.challenge`) |
| POST | `/webhooks/meta` | — | Eventos Meta (HMAC) |
| POST | `/webhooks/evolution` | — | Eventos Evolution (token de instância) |
| POST | `/webhooks/stripe` | — | Eventos Stripe (assinatura `stripe-signature`) |
| POST | `/webhooks/asaas` | — | Eventos Asaas (header `asaas-access-token` = `ASAAS_WEBHOOK_TOKEN`; 403 se não bater) |

## Exemplos

**Criar número não-oficial e pegar o QR:**
```bash
curl -X POST localhost:4000/numbers -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"phone":"5511999998888","label":"Vendas","provider":"evolution","config":{}}'
# → { id, status: "pending_qr", qrCode: "data:image/png;base64,..." }
```

**Trocar para Meta:**
```bash
curl -X PUT localhost:4000/numbers/$ID/provider -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"provider":"meta","config":{"phoneNumberId":"1234","wabaId":"5678","accessToken":"EAAG..."}}'
```

**Enviar texto:**
```bash
curl -X POST localhost:4000/conversations/$CONV/messages -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"text","text":"Olá! Como posso ajudar?"}'
```

**Enviar imagem:**
```bash
KEY=$(curl -s -X POST localhost:4000/uploads -H "Authorization: Bearer $TOKEN" -F "file=@foto.jpg" | jq -r .key)
curl -X POST localhost:4000/conversations/$CONV/messages -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"type\":\"image\",\"mediaKey\":\"$KEY\",\"text\":\"Segue a foto\"}"
```

**Relatório — conversas por tag na última semana:**
```bash
curl -X POST localhost:4000/reports/run -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"metric":"conversations","groupBy":"tag","from":"2026-09-09","to":"2026-09-16","chart":"pie"}'
# → { definition, series: [{label:"lead com interesse", value: 12}, ...] }
```

Métricas: `conversations`, `messages_in`, `messages_out`, `avg_first_response_min`. Agrupamentos: `day`, `week`, `month`, `tag`, `status`, `number`, `agent`, `origin`, `campaign` (título do anúncio). Filtros: `tagIds`, `status`, `numberId`, `origin`.

## Erros

Formato padrão do Nest: `{ statusCode, message, error }`. Códigos relevantes:

| Código | Quando |
|---|---|
| 400 | Validação (campo inválido/desconhecido), janela 24h expirada, conversa encerrada, número desconectado |
| 401 | Token ausente/expirado, webhook não autenticado |
| 403 | Role insuficiente, limite do plano, assinatura suspensa, transferir/devolver conversa que não é sua |
| 409 | Outra atendente já assumiu a conversa |
| 404 | Recurso de outro tenant ou inexistente (nunca revelamos qual) |
| 429 | Throttling |


## IA (copiloto)

Exigem login e a feature `ai_copilot`. Ver [15](15-ia.md).

| Método | Rota | O que faz |
|---|---|---|
| GET | `/ai/status` | `{ available }` — se há fornecedor de IA configurado no ambiente |
| GET | `/ai/usage` | consumo do mês: interações, custo em BRL e quebra por tipo |
| POST | `/ai/suggest` | `{ conversationId }` → `{ text }` — sugestão de resposta (não envia nada) |
| POST | `/ai/rewrite` | `{ text, tone, conversationId? }` → `{ text }` — tons: `formal`, `friendly`, `short`, `clear` |
| POST | `/ai/summary` | `{ conversationId, force? }` → `{ text, updatedAt, cached }` resumo em tópicos. Fica em cache na conversa amarrado à última mensagem: sem mensagem nova devolve o salvo (`cached: true`, sem chamar nem cobrar a IA); `force: true` gera de novo |

`503` = sem fornecedor configurado. `403` = sem a feature no plano, sem quota ou teto de
gasto atingido (a mensagem diz qual).

## Busca textual de contatos

Vale para `search` em `GET /conversations`, `q` em `GET /conversations/start/contacts` e `q` em `GET /numbers/:id/phonebook` (helper `common/text-search.ts`):

- **sem acento e sem diferença de maiúsculas** — "joao" acha "João";
- **por palavras, em qualquer ordem** — "silva maria" acha "Maria da Silva" (cada palavra é um AND; até 5);
- **telefone com ou sem máscara** — termo só com dígitos/`()+-.`/espaço vira um token de dígitos: "(62) 99999-9999" e "629999" acham `5562999999999`;
- contatos: nome, e-mail e telefone; agenda do celular: nome e telefone.

Roda no banco sobre a coluna gerada `searchText` (texto dobrado: minúsculo, sem acento) com índice GIN `pg_trgm`, então escala com a base. A dobra do termo em JS (`foldSearch`) e a da coluna (`translate` na migração `contact_search`) precisam continuar iguais.


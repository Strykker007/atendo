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
| GET | `/tenants` | super_admin | Lista clientes com plano, contagens e `companies` (cada empresa com `billingType`, `isActive` e a assinatura própria, se houver) |
| POST | `/tenants` | super_admin | Cria cliente + assinatura + admin + tags de encerramento padrão (`DEFAULT_LOSS_REASONS`, packages/shared — tags fora do Kanban) + perfis padrão, numa transação só. `templateId?` = modelo de perfil (ausente = o marcado como padrão; `null` = nenhum): perfis, respostas, fluxos (desligados) e tags de encerramento do modelo — ver [20](20-modelos-de-perfil.md). E-mail de admin em uso = 400. Plano gratuito nasce `active`; pago, `trialing` |
| — | `/tenant-templates/*` | super_admin | Modelos de perfil (listar, ler, criar, editar conteúdo/padrão, exportar, importar, carregar, gerar de um cliente) — ver [20](20-modelos-de-perfil.md#api-super_admin) |
| PATCH | `/tenants/:id` | super_admin | `name`, `isActive`, `planId`, `subscriptionStatus` (ajuste manual sem Stripe), `currentPeriodEnd` (`AAAA-MM-DD`, vale até 23:59 de Brasília; 400 se a assinatura tem gateway), `profile` (dados cadastrais; string vazia limpa; CPF 11 / CNPJ 14 dígitos), `billingType` (`INDIVIDUAL`\|`CONSOLIDATED_GROUP`; grupo com assinatura viva no Stripe = 400). Trocar para plano gratuito: assinatura `active`, preço 0, e a assinatura paga no Stripe (se houver) é cancelada |
| GET | `/notices/active` | todos (inclusive dono) | Avisos globais ativos, mais novos primeiro (até 30) — ver [avisos.md](avisos.md) |
| GET | `/super-admin/notices` | super_admin | Todos os avisos (ativos e desativados) |
| POST | `/super-admin/notices` | super_admin | `{title, message, type?: INFO \| WARNING \| CRITICAL}` — grava e emite `system_notice` para todos os conectados |
| PATCH | `/super-admin/notices/:id` | super_admin | `{active}` — desativar tira do sino de todos |
| GET | `/super-admin/owners` | dono | Donos do sistema ([Donos do sistema](donos-do-sistema.md)) |
| GET | `/super-admin/owners/candidates?q=` | dono | Usuários de clientes que podem virar dono |
| POST | `/super-admin/owners` | dono | `{userId}` — marca `isSystemOwner` (continua na empresa) |
| POST | `/super-admin/owners/invite` | dono | `{name, email}` — dono novo sem empresa, por convite (`inviteLink`, `emailSent`) |
| POST | `/super-admin/owners/:id/invite-link` | dono | Novo link de convite (invalida o anterior) |
| POST | `/super-admin/owners/:id/link` | dono | `{tenantId, role, owner?}` — vínculo: a pessoa vira membro de mais um cliente, sem novo login ([multiempresa.md](multiempresa.md)); `owner` = atua como dono lá |
| DELETE | `/super-admin/owners/:id/link/:userId` | dono | Desfaz o vínculo (desativa a linha da empresa; histórico fica) |
| DELETE | `/super-admin/owners/:id` | dono | Tira de dono (a marca sai de todas as empresas da pessoa; `super_admin` sem empresa é desativado). Nunca a si mesmo nem o último |
| GET | `/monitor/tenants` | super_admin | Monitor ao vivo: `{tenantId, onlineUsers, lastActivityAt, numbers[{id, label, phone, color, provider, status, isActive, receiveStalledAt, waRemovedAt, updatedAt}]}[]`. `onlineUsers` = usuários distintos com socket conectado agora (dono "entrando como" não conta); `lastActivityAt` = último login ou renovação de sessão (o access token dura 15 min, então painel aberto renova). Números excluídos ficam fora. Atualização: eventos `tenant_presence`/`tenant_number` na sala `owners` |
| POST | `/tenants/:id/impersonate` | super_admin | `{accessToken, tenant}` — "entrar como" (token com o tenant, papel admin, `impersonatorId`) |
| GET | `/tenants/me/agents` | todos | Atendentes do meu tenant (todos podem listar para transferir) |
| POST | `/tenants/me/agents` | tenant_admin, manager | Cria atendente (`role: agent`) ou gerente (`role: manager`, só admin); respeita `maxAgents` |
| GET | `/auth/memberships` | todos | Empresas da pessoa logada: `{userId, tenantId, tenantName, role, systemOwner, current}[]` ([multiempresa.md](multiempresa.md)) |
| POST | `/auth/switch` | todos | `{userId}` — troca para outra empresa da pessoa: novo access token + refresh cookie da linha escolhida. 403 fora dos vínculos dela |
| PATCH | `/auth/me` | todos (menos dono impersonando) | `{name}` — o próprio nome de exibição. O nome vai no access token: o front chama `/auth/refresh` em seguida |
| PATCH | `/tenants/me/agents/:id` | `team.manage` | Nome (admin da conta edita de qualquer pessoa, inclusive outro admin; gerente só de atendentes) / `email` (login, único sem diferenciar maiúsculas, gravado em minúsculas; admin da conta edita de qualquer pessoa — inclusive outro admin e o próprio —, gerente só de atendentes; `400` se já em uso) / `role` (`agent`\|`manager`, só admin da conta) — `email`/`role` revogam as sessões da pessoa / ativo / `password` (redefine e revoga sessões) / `typingSpeed` (`slow`\|`normal`\|`fast`: velocidade do "digitando…" simulado; sozinho, vale também para admins da equipe) |
| **Números** | | | |
| GET | `/numbers` | todos | Números do tenant. `manageable` = quem pediu pode gerenciar a conexão daquele número (ver [Perfis de acesso](18-perfis-de-acesso.md#gestão-da-conexão-do-número)). `warmup` = fase do aquecimento (`{phase, newConvPerHour, minGapMs, endsAt}` ou `null`, ver [Envio](envio.md#aquecimento)) |
| GET | `/numbers/:id/phonebook?q=&cursor=` | quem opera o número | Agenda do celular do número (sincronizada da Evolution), alfabética, 50 por página: `{ items: [{id, phone, name, contactId}], nextCursor, total? }` (`total` só na 1ª página). `q` filtra por nome ou telefone — [busca textual](#busca-textual-de-contatos). `contactId` preenchido = a pessoa já é contato |
| POST | `/numbers/:id/contacts/sync` | `numbers.manage` + escopo | Relê agora a agenda de contatos do celular (só Evolution conectado; senão 400). Entra na fila do worker — devolve `{ queued: true }`. Uma vez por dia por número (429 antes de 24 h da última). Também roda sozinho uma vez por dia ([Providers](04-providers-whatsapp.md)) |
| GET | `/numbers/:id/templates?refresh=1` | quem opera o número | Templates **aprovados** (HSM) da WABA do número, normalizados em `MessageTemplate` (`@atendo/shared`): nome, idioma, categoria, cabeçalho/corpo/rodapé, botões e variáveis (`headerParams`, `bodyParams` — `1`, `2`… ou nomes). Cache de 5 min por número no processo da API; `refresh=1` busca de novo na Meta. Evolution = `[]`. Cabeçalho de mídia vem em `headerFormat`; botões que pedem valor (link com `{{1}}`, cupom) em `dynamicButtons` (posição + tipo). O que o painel ainda não preenche (cabeçalho de localização, botão de formulário/catálogo, autenticação) vem com `unsupported` (motivo). Na escolha enviada (`template` do envio, start, transmissão, lembrete): `buttons` (`{ "<posição>": valor }`) e `headerMediaKey`/`headerMediaName` (chave de `POST /uploads`) |
| POST | `/numbers` | `numbers.manage` | Cria e conecta (respeita `maxNumbers`). Quem é restrito a alguns números passa a operar o que criou |
| PUT | `/numbers/:id/provider` | `numbers.manage` + escopo | **Troca de provider** |
| POST | `/numbers/:id/connect` | `numbers.manage` + escopo | Reconecta / QR novo. `{force?}`: durante a pausa após o WhatsApp derrubar o número responde 409 `reconnect_paused` (`until`, `removedCount`); `force: true` reconecta mesmo assim — ver [providers](04-providers-whatsapp.md#quando-o-whatsapp-derruba-o-número-401-device_removed). `GET /numbers` traz `waRemovedAt`, `waRemovedCount`, `reconnectBlockedUntil` |
| PATCH | `/numbers/:id` | `numbers.manage` + escopo | Label / cor (`color`, `#rrggbb`) / ativo. `sendDelay`, `sendLimits`, `sendDailyLimit`, `endWarmup` e `infraCostMonth` só valem para o dono (super_admin ou impersonando); do cliente são descartados em silêncio |
| POST | `/numbers/:id/restart` | `numbers.manage` + escopo | Só Evolution conectado: fecha e reabre a sessão sem logout nem QR. **429** se a conexão foi reiniciada (pelo painel ou automaticamente) há menos de 2 min — mesma vaga do restart automático ([28](28-estabilizacao-conexao.md)). `GET /numbers` traz `receiveStalledAt` (envia mas parou de receber — ver [providers](04-providers-whatsapp.md#parou-de-receber-envia-mas-nada-chega)) |
| POST | `/numbers/:id/disconnect` | `numbers.manage` + escopo | Encerra a sessão (logout na Evolution) sem excluir; número e conversas ficam, status `disconnected` |
| DELETE | `/numbers/:id` | `numbers.manage` + escopo | Exclui = tira do provider e **arquiva** (`deletedAt`): conversas ficam guardadas, fora da lista. `POST /numbers` com o mesmo telefone na mesma conta revive o número com o histórico; telefone ativo duplicado → 409 |
| **Conversas** | | | |
| GET | `/conversations?status=&numberId=&departmentId=&tagIds=a,b&search=&origin=&assigneeId=&sort=&cursor=` | todos | Lista por cursor. `departmentId` = id ou `none` (sem departamento), sempre interseccionado com o escopo de departamentos do usuário ([Departamentos](departamentos.md)). Em `in_progress`, atendente vê só as suas; admin vê todas ou filtra por `assigneeId` (também em `closed`, para auditar por consultor; `assigneeId=none` = só as sem atendente). `status=closed` ordena por `closedAt` desc (a recém-encerrada no topo, ignora `sort`). `sort=waiting` ordena por quem espera resposta há mais tempo (`awaitingSince` asc, já respondidas por último). `search` = [busca textual](#busca-textual-de-contatos) no nome/e-mail/telefone do contato. `closeReasonId?` / `lastOutcome?` (won\|lost) = último encerramento da conversa (qualquer aba); cada conversa traz `lastClosedAt`, `lastCloseOutcome`, `lastCloseReason{id,name,color}` |
| GET | `/conversations/cold-quota?numberId=` | todos | Vagas de contato frio do número QR nas últimas 24 h: `{ ok, used, max, resetsAt }`; `null` no oficial ([Envio frio](envio.md#envio-frio)) |
| GET | `/conversations/counts?numberId=&departmentId=` | todos | `{waiting, in_progress, closed, in_progress_mine, in_progress_all}` (`in_progress` já respeita a visão do usuário) |
| GET | `/conversations/:id` | todos | Uma conversa (contato, tags, atendente, número) |
| GET | `/conversations/:id/messages?cursor=` (ou `?after=&until=`) | todos | Mensagens (mais recentes primeiro, 50); `mediaUrl` já vem assinada. **Nada é apagado**: o painel carrega a última página e busca o passado conforme a pessoa rola, com `cursor` = id da última linha recebida. Página incompleta (começo do que está no banco) em número Evolution: completa com o histórico guardado no provider antes de responder ([Histórico](historico-de-mensagens.md)). Com `until` (ISO; `after` opcional): **um atendimento** — mensagens com `after < createdAt ≤ until`, em ordem crescente, até 1000 (auditoria de `GET /reports/attendances`) |
| POST | `/conversations/:id/messages` | todos | Envia: `{type:'text', text}` ou `{type:'image'|'audio'|'video'|'document', mediaKey, text?}` ou template `{type:'text', template: { name, language, header?, body? }}` — conferido na Meta no número da conversa, valores aceitam `{{contact.first_name}}` etc. (variável vazia = 400; número Evolution = 400). É como o composer retoma a conversa com a janela de 24h fechada. Sai **sempre** pelo número da conversa (nenhum campo escolhe o número; campo extra = 400). `expectedNumberId?` = canal mostrado na tela: divergiu → 409 `{code:'number_changed'}` sem enviar. Número inativo/de outro tenant ou desconectado → 422. Contato frio (não escreveu neste número em 24 h): Evolution → gasta 1 das 10 vagas diárias de contato frio do número; sem vaga → 409 `{code:'cold_quota_exhausted', resetsAt}` (envio automático para contato frio → 409 `{code:'cold_send_unofficial'}`); Meta sem o recurso `proactive_messaging` → 403 `{code:'feature_proactive'}` ([Envio frio](envio.md#envio-frio)); o mesmo vale para `POST /conversations/start`. `idempotencyKey?` (até 100 caracteres, uma por envio): repetir com a mesma chave devolve a mensagem já criada, sem enfileirar de novo ([Envio](envio.md#deduplicação)). `quotedExternalId?` = id no provider da mensagem respondida (citação, ver [Providers](04-providers-whatsapp.md)). Texto com `{{...}}` (resposta rápida, `{{saudacao}}`, campos da ficha) é resolvido aqui — chave desconhecida fica como escrita ([Variáveis](variaveis.md)). `simulateTypingChars?` = caracteres que o atendente não digitou (resposta rápida, colado, só mídia): "digitando…" simulado antes da entrega (só Evolution). `pixKeyId?` = chave Pix cadastrada (ignora `text`/mídia): a API monta texto (título, tipo, chave), `raw.pix` e, só com `EVOLUTION_PIX_BUTTON=true`, `content` com botão `copy` "Copiar chave Pix"; por padrão sai texto (cartão em conta QR é entregue mas não aparece no aparelho — [Providers](04-providers-whatsapp.md)); Meta envia o texto |
| GET | `/conversations/start/contacts?q=` | todos | Busca do *Nova conversa* (≥ 2 caracteres, [busca textual](#busca-textual-de-contatos)): `{ contacts: [{id, name, phone, avatarUrl}], phonebook: [{phone, name, numberId}] }` — até 8 contatos da base e até 8 nomes da agenda do celular (Evolution) que ainda não são contato. Usuário restrito a números/departamentos só vê contato que já conversou por eles e só a agenda dos números que opera |
| POST | `/conversations/start` | todos | **Iniciar conversa** (disparo ativo). `{ numberId, contactId? \| phone?, name?, text? \| template?: { name, language, header?: {"1": "…"}, body?: {…} }, idempotencyKey? }`. Contato por id ou telefone (DDI+DDD+número; reaproveita o contato existente, com ou sem o nono dígito, senão cria com `name` manual). Uma conversa por contato+número: existe → usa (encerrada é reaberta como atendimento de quem iniciou); não existe → cria. Depois é um `send` normal (posse, quota, ledger, fila com o ritmo do número). **Sem `text` e sem `template` = só abrir**: nada é enviado (sem quota, ledger, checagem de WhatsApp nem regra de envio frio — essas valem quando a pessoa escrever no chat); número desconectado é aceito; conversa nova nasce **assumida** por quem abriu (`in_progress`, evento `claimed`), existente fica como está (encerrada não é reaberta). As recusas de escopo, departamento e `already_assigned` valem igual. Meta: sem template só dentro da janela de 24h (400); template é conferido na Meta e os valores aceitam `{{contact.first_name}}` etc. (variável vazia = 400). Evolution + template = 400. Número fora do escopo do usuário = 403; desconectado = 422; conversa aberta de outro atendente = 409 `{code:'already_assigned', conversationId}`; em departamento que o usuário não vê = 409 `{code:'other_department'}`. Devolve `{ conversationId, status, message }` (`message` = `null` quando só abriu; `status` = aba em que a conversa está) |
| GET | `/conversations/contacts?q=&cursor=` | todos | Tela **Contatos**: a base no escopo de quem pede (mesma régua do `start/contacts`: restrito a números/departamentos só vê quem conversou por eles), sem grupos, em ordem de nome, 50 por página. Cada item: a ficha (`id, name, phone, avatarUrl, email, document, address, note1, note2, tags, optOutAt, waInvalidAt`) + `lastConversation` (a mais recente no escopo: `id, status, lastMessageAt, number {id,label}, assignee`) ou `null`. `q` = [busca textual](#busca-textual-de-contatos). Devolve `{ items, nextCursor }` |
| POST | `/conversations/:id/notes` | `conversations.internal_note` | Nota interna `{ text }` (1–4096, vazio/só espaços = 400). Grava `internal: true`, `status: delivered`, `authorId` + `authorName`; **nunca** entra na fila de envio e não passa pelo `UsageService`. Não assume a conversa — vale também em conversa de outra pessoa ou encerrada. Emite `message` no socket |
| POST | `/conversations/:id/claim` | todos | Assumir (atômico; 409 se outra pessoa assumiu) |
| GET | `/conversations/:id/transfer-targets` | quem vê a conversa | `[{id,name}]` de quem pode receber: ativo e com acesso ao número (e departamento) da conversa — ver [Empresas › Transferência](empresas.md#transferência) |
| POST | `/conversations/:id/transfer` | dono ou admin | `{agentId}`. Destino sem acesso ao número da conversa → 403. Quem recebe ganha o evento `transfer_alert` (só na sala dele). Com **Avisar o cliente ao transferir** ligado (`transferMessageEnabled`), sai ao cliente o texto de `transferMessageText` (`{{atendente}}` = primeiro nome) como mensagem do sistema — fila de saída, quota, janela de 24h da Meta; se não puder sair, a transferência acontece igual |
| POST | `/conversations/:id/release` | dono ou admin | Devolve à fila (waiting, sem dono) |
| PATCH | `/conversations/:id/department` | dono, `transfer_any` ou qualquer um se sem dono | `{departmentId: uuid \| null}` — vai para a fila (Aguardando, sem dono) do departamento; encerrada só troca. Grava `department_changed`. Com o aviso ao cliente ligado, manda `departmentTransferMessageText` (`{{departamento}}`); tirar de departamento (`null`) não avisa |
| POST | `/conversations/:id/messages/:messageId/resend` | todos | "Tentar novamente": mensagem `failed` volta para `pending` no fim da fila da conversa. 409 se já foi reenviada (clique duplo) ou se a conversa mudou de canal (`number_changed`); número desconectado → 400 |
| POST | `/conversations/:id/messages/:messageId/react` | todos | Reação do atendente `{ emoji }` (vazio = retirar). Manda pelo provider e **só grava se ele aceitar**; emite `message` no socket. Recusa: mensagem sem `externalId`/pendente/falha, conversa encerrada, número desconectado, conversa de outro atendente (409), fora da janela de 24h (Meta). Não assume a conversa e não passa pelo `UsageService` |
| DELETE | `/conversations/:id/messages/:messageId` | própria recente: todos; demais: `conversations.delete_message` | Apaga a mensagem ([regras](apagar-mensagens.md)). Enviada por nós, < 48h, número conectado: pede "apagar para todos" ao provider (Evolution); Meta/prazo/recusa/recebida = só no painel. Pendente = cancela o envio. Nunca remove a linha: grava `deletedAt/deletedById/deletedByName/deletedForEveryone` + evento `message_deleted`. Devolve `{ message, forEveryone, notice }` (`notice` = por que foi só no painel). Emite `message` (já sem conteúdo) e `conversation`. Já apagada = 409 |
| PATCH | `/conversations/:id/messages/:messageId` | `conversations.edit_message` | Edita uma mensagem de texto enviada pelo número `{ text }` — de qualquer origem (própria, de colega, do celular, da automação); recebida e nota interna = 400. Na fila: troca só o texto. Enviada: edita no provider (Evolution, ≤ 15 min) e só grava se ele aceitar; Meta = 422; prazo/falha = 409. Grava `editedAt` + evento `message_edited` (texto anterior). Ver [Editar mensagens](editar-mensagens.md) |
| GET | `/conversations/:id/messages/:messageId/original` | `conversations.view_deleted` | Conteúdo original de uma apagada (`DeletedMessageOriginal`, mídia em URL assinada) |
| DELETE | `/conversations/:id` | `conversations.delete_conversation` | Exclui a conversa de vez (mensagens, eventos, tags, agendadas, fluxos — cascade); o contato fica. Com venda ou orçamento pago = 400 `has_sales`. Auditoria `conversation.deleted`; emite `conversation_deleted`. Ver [Apagar mensagens › Excluir conversa](apagar-mensagens.md#excluir-conversa) |
| DELETE | `/conversations/:id/messages` | `conversations.delete_chat` | Limpa o histórico: todas as mensagens apagadas só no painel, pendentes canceladas, evento `history_cleared`. Devolve `{ cleared, cancelled }`. Emite `messages_cleared` e `conversation`. Sem mensagens = 400 |
| POST | `/conversations/:id/messages/:messageId/forward` | todos | Encaminhar `{ targetConversationIds: uuid[] }` (1–5). Cada destino é um `send` normal marcado `forwarded: true` (quota, janela da Meta, "responder = assumir", ledger). Mídia reaproveita o arquivo do storage; localização vira texto com link do Maps, contato vira nome + telefone, botões/lista viram o texto. Recusa figurinha e mídia ainda não baixada. Destino fora do escopo de números do usuário = "não encontrada". Devolve `{ sent: Message[], failed: { conversationId, error }[] }` — falha num destino não derruba os outros |
| GET | `/conversations/:id/scheduled-messages` | todos | Mensagens agendadas `pending`/`failed` da conversa ([Agendamento de mensagens](agendamento-de-mensagens.md)) |
| POST | `/conversations/:id/scheduled-messages` | `conversations.schedule_message` | Agenda `{content, scheduledFor (ISO), mediaKey?, mediaType?, mediaName?, mediaMime?}`. ≥ 1 min à frente, ≤ 365 dias; conversa de outra pessoa = 409; Meta fora da janela de 24h = 400. Socket `scheduled_messages` |
| DELETE | `/conversations/:id/scheduled-messages/:scheduledId` | `conversations.schedule_message` | Cancela pendente / dispensa falhada (já enviada = 404) |
| GET / POST / PATCH | `/conversations/:id/budgets[/:budgetId]` | todos | Orçamentos com link público — ver [Orçamentos](orcamentos.md#api). Públicos (sem login): `GET /budgets/public/:hash` e `POST /budgets/public/:hash/receipt` |
| PATCH | `/conversations/:id/status` | todos | `{status: waiting \| in_progress \| closed, outcome?, value?, tagIds?, products?, items?, notes?, flowId?}`. No encerramento `outcome` é **obrigatório** e só `won` ou `lost` (sem ele ou `none` = 400 — "Sem resultado" saiu). `won` exige valor (`value` > 0 ou soma de `items` > 0, senão 400) e grava uma linha em `sales` com `products`/`notes`. `tagIds` (opcional, até 20; o antigo motivo) são somadas às tags da conversa e congeladas no evento `closed` (`tagIds` + nomes em `reason`); id de outro cliente é ignorado. Com `items` (`[{description?, value}]`, até 50 — descrição opcional) o total é a soma dos itens — `value` enviado é ignorado e o resumo `products` vira as descrições preenchidas. `flowId` ausente = fluxo padrão do resultado (`wonFlowId`…) ou o geral (`onCloseFlowId`); `null` = nenhum. `closeReasonId?` = motivo (obrigatório quando há motivo ativo para o resultado → 400 `close_reason_required`). Encerrar congela no evento as tags da conversa (`tagSnapshot`, etapa em `stageTagId`) e as tira da conversa (transitórias); grava `lastClosedAt/lastCloseOutcome/lastCloseReasonId`. `surveyId?` = pesquisa de satisfação ([pesquisa-de-satisfacao.md](pesquisa-de-satisfacao.md)): ausente = a padrão, `null` = nenhuma, id inválido = 400 antes de encerrar; com pesquisa o fluxo de encerramento não roda. `internal: true` = atendimento interno (nunca envia pesquisa): exige `conversations.close_internal` (403), dispensa `outcome`/valor (grava `none`, sem venda), só aceita motivo `ignoreInReports`, não dispara fluxo padrão (só o `flowId` explícito), sai dos relatórios e grava `audit_logs`. Motivo com `requiresTag` sem tag no atendimento = 400 `close_reason_requires_tag` |
| POST | `/conversations/bulk/close` | todos | `{ids[], outcome, tagIds?, closeReasonId?}` — encerra até 200. Devolve `{closed, ignored, withPayment}` — `withPayment` = conversas com orçamento pago no atendimento, que ficam abertas (encerrar uma a uma, como venda). O recorte (números do usuário; atendente comum só o que é dele ou está sem dono) é feito no service, porque o `ConversationScopeGuard` olha `:id` e aqui a lista vem no corpo. Sem valor de venda e sem fluxo, de propósito: `outcome` obrigatório e só `lost` na prática (`won` = 400: venda é uma a uma, com valor); `tagIds` opcionais, aplicadas a todas. `internal: true` = todos como atendimento interno (mesmas regras do `PATCH …/status`, uma linha de `audit_logs` por conversa, `data.bulk = true`) |
| GET | `/audit-logs?action=conversation.closed_internal&from=&to=&actorId=&page=&pageSize=` | `profiles.manage` | Auditoria imutável, mais recente primeiro. `from`/`to` (ISO, `to` exclusivo) = período; `actorId` = quem fez: `{total, page, pageSize, rows[{id, action, actorId, actorName, entityType, entityId, contactId, contactName, data, createdAt}]}` |
| GET | `/conversations/:id/events` | todos | Histórico do atendimento: `claimed`, `transferred`, `released`, `closed`, `reopened`, `bot_paused`, `bot_resumed`, `department_changed` (`reason` "A → B"), com ator, alvo, desfecho congelado e data |
| POST | `/conversations/:id/bot/pause` | todos (feature `flows`) | Pausa o robô só nesta conversa. Body `{ minutes?: 30 \| 60 \| 240 \| null }` (nulo = até retomar). Interrompe o fluxo em andamento. Ver [fluxos › Pausar o robô](fluxos.md#pausar-o-robô-na-conversa) |
| POST | `/conversations/:id/bot/resume` | todos (feature `flows`) | Retoma o robô (o fluxo interrompido não volta) |
| PATCH | `/conversations/:id/tags` | todos | `{tagIds: []}` substitui as tags. Tag nova na lista tira as opostas diretas dela (`tag_conflicts`; com duas opostas novas, vale a última da lista). A principal se mantém se continuar na lista; senão a primeira tag de coluna (ordem do Kanban) assume. Emite `conversation` |
| PATCH | `/conversations/:id/primary-tag` | todos | `{tagId: uuid \| null}` troca a tag principal (mover card no Kanban). A antiga vira secundária; a nova entra se faltava. `null` = "Sem etapa". 400 se a tag não for `isKanban`. Emite `conversation` |
| PATCH | `/conversations/contacts/:contactId` | `contacts.edit` | Ficha (`name`, `email`, `address`, `note1`, `note2`) e `resubscribe: true` = volta a receber mensagens automáticas (limpa `optOutAt`, [Descadastro](envio.md#descadastro)) |
| PATCH | `/conversations/contacts/:contactId/tags` | todos | `{tagIds}` substitui as tags **do contato** (permanentes); mesma troca de opostas do atendimento. Só tags do tenant |
| **Campos livres da ficha (por contato)** | | | |
| GET | `/contact-attributes/labels` | todos | Nomes já usados na empresa (`{label, type}`), mais usados primeiro — sugestão ao digitar |
| GET | `/contact-attributes/:contactId` | todos | Campos do contato, na ordem: `{id, label, type: text\|number\|date, value}[]` |
| GET | `/tenants/me/global-variables` | todos | Variáveis da empresa: `{id, key, label, value, updatedAt}[]`, por nome |
| POST | `/tenants/me/global-variables` | `variables.manage` ou `flows.manage` | `{label, key?, value}` — sem `key`, gerada do nome ("Chave PIX" → `chave_pix`). Chave inválida/reservada (`empresa`, `saudacao`…) = 400; repetida = 409; até 200 por empresa |
| PUT | `/tenants/me/global-variables/:id` | `variables.manage` | `{label?, key?, value?}` (trocar a chave quebra os textos que usam a antiga) |
| DELETE | `/tenants/me/global-variables/:id` | `variables.manage` | Remove |
| GET | `/tenants/me/pix-keys` | todos | Chaves Pix: `{id, title, keyType, key, holderName, position}[]` |
| GET | `/close-reasons` | todos | Motivos de encerramento `{id, name, color, outcome: 'won'\|'lost'\|'both', ignoreInReports, requiresTag, position, isActive}[]` (inclui desativados, para filtros de histórico) |
| POST / PATCH / DELETE | `/close-reasons[/:id]` | `settings.manage` | `{name, color?, outcome?, ignoreInReports?, requiresTag?}`; PATCH também `isActive`. `ignoreInReports` = motivo de atendimento interno ([encerramento interno](06-modelo-de-dados.md#encerramento-interno)). DELETE desativa (histórico guarda id e nome); criar com o nome de um desativado reativa. Até 100 ativos |
| PATCH | `/close-reasons/order` | `settings.manage` | `{ids}` na ordem nova |
| GET | `/satisfaction-surveys` | todos | Pesquisas de satisfação `{id, name, scale: 'scale_5'\|'scale_10'\|'csat_3', question, allowDecline, declineLabel, askComment, extraQuestions[{id, text, scale}] (até 2), commentPrompt, thanksMessage, declinedMessage, expiresHours, isDefault, isActive}[]` (inclui desativadas) |
| POST / PATCH / DELETE | `/satisfaction-surveys[/:id]` | `settings.manage` | Mesmos campos (`declineLabel` até 20, `expiresHours` 1–168). A primeira ativa nasce padrão; marcar `isDefault` desmarca as outras. DELETE desativa. Até 20 ativas |
| POST / PUT | `/tenants/me/pix-keys[/:id]` | `quick_replies.manage` | `{title, keyType: 'cpf'\|'cnpj'\|'email'\|'phone'\|'random', key, holderName?}`. Chave conferida e normalizada pelo tipo (CPF/CNPJ só dígitos, telefone `+55…`, e-mail/aleatória minúsculas); inválida = 400; até 30 |
| PATCH | `/tenants/me/pix-keys/reorder` | `quick_replies.manage` | `{ ids: string[] }` na ordem nova (setas ↑↓ na tela) — a ordem da pasta "Pix" no chat; id de outro cliente é ignorado |
| DELETE | `/tenants/me/pix-keys/:id` | `quick_replies.manage` | Remove (mensagens já enviadas não mudam) |
| PUT | `/contact-attributes/:contactId` | `contacts.edit` | `{items: {label, type, value}[]}` (até 50) **substitui** a lista. Linha toda em branco é ignorada; nome sem valor (ou o contrário), número/data inválidos e nome repetido = 400 |
| POST | `/conversations/:id/read` | todos | Zera não-lidas. Também assina o "digitando…" do contato no provider (Evolution; no máx. 1×/2 min por contato, sem esperar a resposta) |
| PATCH | `/conversations/:id/unread` | todos | Marcar como não lida. Body opcional `{ messageId }`: conta como não lidas as recebidas a partir dela; sem ele, no mínimo 1 (mantém as que já havia). Nunca menos de 1. Emite a conversa pelo socket. Só no painel — nada vai ao provider |
| POST | `/conversations/:id/typing` | todos | `{state?: 'composing'\|'paused'}` (padrão `composing`). Atendente digitando → "digitando…" no WhatsApp do contato enquanto o painel renovar (a cada ~2 s; expira em 4 s sem renovação); `paused` apaga na hora. Só Evolution conectada e conversa aberta. 204, nunca falha |
| **Departamentos** | | | |
| GET | `/departments` | todos | Com participantes e nº de conversas abertas |
| POST / PATCH / DELETE | `/departments[/:id]` | `team.manage` | `{name, description?, color?, isActive?, userIds?}` (`userIds` substitui). Excluir deixa as conversas sem departamento. Ver [Departamentos](departamentos.md) |
| **Empresas / unidades** | | | Toda rota aceita o header `x-company-id` (empresa do seletor): vira escopo de números. Ver [Empresas](empresas.md) |
| GET | `/companies` | todos | Empresas do cliente com números e pessoas vinculadas |
| GET | `/companies/mine` | todos | Empresas que o usuário pode escolher no seletor (`[]` = cliente sem empresas) |
| POST / PATCH / DELETE | `/companies[/:id]` | `settings.manage` | `{name, cnpj?, description?, numberIds?, userIds?}` (listas substituem; marcar um número tira ele da outra empresa). `POST` checa `maxCompanies` do plano. Excluir **remove sem apagar** ([Remover](empresas.md#remover)): números ativos ficam sem empresa; a empresa continua nos relatórios com o histórico dos números excluídos |
| GET | `/admin/tenants/:tenantId/companies` | super_admin | Empresas do cliente (mesmo formato de `GET /companies`) |
| GET | `/admin/tenants/:tenantId/companies/options` | super_admin | `{numbers[{id,label,phone}], users[{id,name,isActive}], maxCompanies}` para o formulário |
| POST / PATCH / DELETE | `/admin/tenants/:tenantId/companies[/:id]` | super_admin | Mesmo corpo de `/companies`. **Sem** o limite `maxCompanies` do plano (exceção do dono) |
| PUT | `/admin/tenants/:tenantId/companies/:id/billing` | super_admin | `{billingType: 'INDIVIDUAL'\|'CONSOLIDATED_GROUP', isActive?, planId?, priceMonth?: number\|null, currentPeriodEnd?: 'AAAA-MM-DD', status?}`. INDIVIDUAL cria/atualiza a assinatura própria (`planId` obrigatório na primeira vez). Recalcula as unidades do grupo. Ver [empresas.md#cobrança](empresas.md#cobrança) |
| **Tags** | | | |
| GET | `/tags` | todos | Com contagem de conversas e `conflictIds` (opostas diretas, dos dois lados do par) |
| PUT | `/tags/:id/conflicts` | `tags.manage` | `{ids: uuid[] (até 20)}` substitui as opostas da tag (par simétrico; ignora a própria e id de outro tenant) → `{conflictIds}` |
| POST / PATCH / DELETE | `/tags[/:id]` | `tags.manage` | `{name, color, isKanban?, showOnWon?, showOnLost?, position?}` (`showOnWon`/`showOnLost` = aparece ao encerrar como Comprou / Não comprou). Lista vem na ordem do Kanban (`position`, nome). Emite `kanban` |
| POST | `/tags/bulk` | `tags.manage` | Criar várias: `{items: {name (40 caracteres), color?}[] (até 500), color? (das que vêm sem cor), isKanban? (padrão false), showOnWon?, showOnLost? (padrão false)}` → `{created, skipped}` (repetida/já existente = `skipped`). Emite `kanban` |
| PATCH | `/tags/bulk` | `tags.manage` | `{ids: uuid[] (até 500), color?, isKanban?, showOnWon?, showOnLost?}` → `{updated}`. `isKanban:false` rebaixa as principais delas. Filtrado pelo tenant (id de outro cliente não casa). Emite `kanban` |
| POST | `/tags/bulk-delete` | `tags.manage` | `{ids: uuid[]}` → `{deleted}`; sai das conversas e contatos (cascade). Emite `kanban` |
| PATCH | `/tags/order` | `tags.manage` | `{ids: uuid[]}` = todas as tags na ordem nova (arrastar na tela de Tags); `position` = índice. É também a ordem das colunas do Kanban. Emite `kanban` |
| **Kanban** | | | |
| GET | `/kanban?numberId=` | todos | `KanbanBoard` (`packages/shared/src/kanban.ts`): colunas (tags `isKanban`) + cards dos atendimentos abertos que a pessoa enxerga (mesma regra de posse/número da lista). Até 500, mais recentes primeiro (`truncated`) |
| PATCH | `/kanban/columns` | `tags.manage` | `{tagIds}` nova ordem das colunas. Emite `kanban` |
| **Respostas rápidas** | | | |
| GET | `/quick-replies` | todos | Pastas com respostas |
| POST / PATCH / DELETE | `/quick-replies/folders[/:id]` | todos | Pastas |
| POST / PATCH / DELETE | `/quick-replies[/:id]` | todos | Respostas |
| PATCH | `/quick-replies/folders/reorder` | `quick_replies.manage` | `{ items: [{ id, position }] }` — ordem das pastas |
| PATCH | `/quick-replies/reorder` | `quick_replies.manage` | `{ items: [{ id, position, folderId? }] }` — ordem das respostas (arraste ou setas ↑↓ na tela); `folderId` move para outra pasta (do mesmo tenant) |
| POST | `/quick-replies/duplicate` | `quick_replies.manage` | `{ ids }` → `{ replies }` — cópia na mesma pasta, título com " (cópia)", anexo mantido (mesmo cliente) |
| GET | `/quick-replies/:id/export` | `quick_replies.manage` | `{ portable, warnings }` — `{ atendo: 'quick-reply', version, folder, title, body }`; anexo não vai (chave carrega o tenant), com aviso |
| POST | `/quick-replies/export` | `quick_replies.manage` | `{ ids }` → `{ bundle, warnings }` — `{ atendo: 'quick-reply-bundle', version, items }`, cada item igual ao individual |
| POST | `/quick-replies/import` | `quick_replies.manage` | `{ portable }` (individual ou lote) → `{ replies, warnings }`. Pasta achada pelo nome ou criada; título repetido na pasta ganha " (cópia)"; tudo ou nada (transação) |
| **Configurações** | | | |
| GET / PATCH | `/settings` | todos / `settings.manage` | Fuso, `attendanceActive`, fluxos padrão, boas-vindas (`welcomeEnabled`, `welcomeMessages`, `welcomeMode`), `requireSaleValue` (padrão `true`: "Comprou" exige valor > 0 no `PATCH /conversations/:id/status` — orçamento pago no atendimento conta; `false` = pode encerrar sem valor — conta na conversão, não cria venda), `salesEnabled` (padrão `true`; `false` = encerramento sem venda: valor/itens/produtos/observação ignorados e "Comprou" liberado no encerramento em massa — ver [06](06-modelo-de-dados.md#encerramento-sem-venda)), `requireSignature` (padrão `false`; `true` = a API assina com `*Nome:*` toda mensagem do atendente que chegar sem), `requireReasonOnWon` / `requireReasonOnLost` (padrão `true`: motivo obrigatório em cada resultado, quando há motivo cadastrado para ele), `wonLabel`/`lostLabel` (nome dos resultados, até 30 caracteres; vazio = padrão — as mensagens de erro do encerramento usam esses nomes). GET traz `isOpenNow`, `currentBand`, `nextOpenLabel` |
| GET / POST | `/settings/schedules` | todos / `settings.manage` | Quadros de horários. POST `{ name, timezone?, config?, copyFromId? }` |
| PUT / DELETE | `/settings/schedules/:id` | `settings.manage` | `{ name?, timezone?, config? }` validado (`validateSchedule`); devolve `renamedConditions` (faixa renomeada atualiza as condições dos fluxos); o padrão não pode ser excluído |
| POST | `/settings/schedules/:id/default` | `settings.manage` | Torna o quadro padrão |
| PUT | `/settings/numbers/:numberId/schedule` | `settings.manage` | `{ scheduleId \| null }` — quadro próprio do número. Ver [Horários](horarios.md#api) |
| **Mídia** | | | |
| POST | `/uploads` | todos | multipart `file` → `{key, url, mimeType, fileName, size}` |
| GET | `/media/*path?exp=&sig=` | — (assinatura) | Serve o arquivo se a assinatura for válida |
| **Billing** | | | |
| GET | `/billing/plans` | todos | Planos ativos com limites, `billingCycle`, `isFree`, `durationDays`, `priceYear`, `stripePriceId` e `promotion` (`{name, discountPercent, durationMonths, endsAt, priceMonth} \| null`: o que ESTE cliente ganha ao assinar). Cliente só recebe `monthly`/`yearly`; super_admin recebe todos (inclui gratuitos, para atribuir) |
| GET | `/billing/plans/all` | super_admin | Catálogo completo (inclui inativos) com `subscribers` e `billingEnabled` |
| POST | `/billing/plans` | super_admin | Cria plano. `{name, priceMonth, billingModel, limits, isFree?, billingCycle?, durationDays?, priceYear?}` — `limits` validado campo a campo (`maxNumbers/maxAgents/maxFlows/maxQuickReplies/maxCompanies`: `null` = ilimitado). Gratuito zera preço e força `hardLimit`. Cria produto+preço no Stripe quando a cobrança está ligada |
| PATCH | `/billing/plans/:id` | super_admin | Edita. Trocar `billingCycle` com assinantes = 400. Mudar `priceMonth` (ou `priceYear`) cria um preço novo no Stripe e arquiva o antigo (preço é imutável lá). `applyToExisting: {mode: 'never'\|'scheduled'\|'now', days?}` decide o que acontece com quem já assina — padrão `never` |
| DELETE | `/billing/plans/:id` | super_admin | Só sem assinantes (senão 400). Arquiva o produto no Stripe |
| GET | `/billing/overrides/:tenantId` | super_admin | Personalização do plano do cliente: `{subscription: {planId, status, gateway, units, priceMonth, plan: {id, name, priceMonth, billingCycle, isFree, limits}} \| null, override \| null, active, inactiveReason: 'other_plan'\|'expired'\|null, effectiveLimits}` |
| PUT | `/billing/overrides/:tenantId` | super_admin | `{priceMonth?: number\|null, limits?: PlanLimitsOverride, expiresAt?: 'AAAA-MM-DD'\|null, notes?}` → mesmo formato do GET. Grava para o plano atual; valor vai ao Asaas antes. 400: sem assinatura, nada informado, data passada, valor em plano gratuito ou assinatura no Stripe |
| POST | `/billing/overrides/:tenantId/promotion` | super_admin | `{promotionId}` → mesmo formato do GET. Aplica a promoção só a este cliente (fora da janela e do plano da promoção também); substitui a personalização; registra no livro de descontos |
| DELETE | `/billing/overrides/:tenantId` | super_admin | Remove; limites voltam na hora e o valor volta ao de tabela (assinatura e Asaas) |
| GET | `/billing/promotions` | super_admin | Promoções com `redemptions` (clientes que ganharam) |
| POST | `/billing/promotions` | super_admin | `{name, discountPercent (0,01–99), durationMonths (1–60), planIds[], startsAt?: 'AAAA-MM-DD', endsAt: 'AAAA-MM-DD', isActive?}`. Plano gratuito = 400 |
| PATCH | `/billing/promotions/:id` | super_admin | Mesmo corpo; vale para quem assinar dali em diante |
| POST | `/billing/promotions/:id/apply-all` | super_admin | Aplica a todos os clientes que assinam hoje um dos planos → `{applied, skipped: [{tenant, reason}]}` (pula personalização valendo, quem já tem a promoção, desativados e Stripe) |
| DELETE | `/billing/promotions/:id` | super_admin | Apaga; quem já ganhou mantém o desconto até o fim do prazo |
| GET | `/billing/invoices` | todos | Faturas do tenant (espelho do Stripe ou das cobranças do Asaas) |
| POST | `/billing/checkout` | tenant_admin | `{planId}` → `{url}` do Checkout (ou troca com proration se já assina). Plano gratuito/personalizado = 400 (só o dono atribui) |
| POST | `/billing/portal` | tenant_admin | `{url}` do Customer Portal |
| GET | `/billing/margin?period=` | super_admin | Margem por cliente |
| GET | `/billing/finance?months=` | super_admin | Financeiro completo: `now.discountMonth`/`discountedTenants` (desconto vigente), `series[].discounts`, `discounts[]` (livro de descontos inteiro), MRR/ARR, ativos/teste/pendentes/suspensos, em atraso, série mensal (faturado, recebido, atrasado, excedente, custo, novos, cancelados), por plano, assinaturas, faturas |
| POST | `/billing/sync-plans` | super_admin | Cria Products/Prices no Stripe |
| GET | `/billing/usage` | todos | Uso do mês (mensagens, templates, números, atendentes, fluxos ativos, respostas rápidas), limites, status, mensalidade, excedente, fim do período, `freePlan: {durationDays} \| null`, `billingCycle`, `gateway` (`asaas\|stripe\|null`, dos checkouts novos) `subscriptionGateway` (onde a assinatura atual nasceu) `quota` (`{unit, ratio, metric, blocked, reason, templatesBlocked, overage} \| null`, mesma regra do envio — o front não recalcula) e `customPlan` (`{expiresAt} \| null`: personalização do dono vigente; `limits` já vêm com ela aplicada) |
| GET | `/billing/asaas/customer` | `billing.manage` | Dados do cliente no Asaas (CPF/CNPJ, e-mail, CEP…) para preencher o checkout; `null` se ainda não existe |
| POST | `/billing/asaas/checkout` | `billing.manage` | `{planId, billingType: 'PIX'\|'CREDIT_CARD', customer: {cpfCnpj, name?, email?, mobilePhone?}, card?: {holderName, number, expiryMonth, expiryYear, ccv}, holder?: {name, email, cpfCnpj, postalCode, addressNumber, phone}}` → `{payment}` (cobrança em aberto, com `pix: {encodedImage, payload, expirationDate}` no PIX). Já assina pelo Asaas = troca plano/forma na mesma assinatura. Assinatura viva no Stripe = 400 |
| POST | `/billing/monthly/enroll` | super_admin | Migra para a mensalidade por Pix no Asaas quem paga sem gateway. `{ dryRun?: boolean }` (padrão `true` = só a prévia). Devolve `[{ tenantId, tenant, plan, value, dueDate, result: 'would_enroll'\|'enrolled'\|'no_document'\|'not_live'\|'no_price'\|'error', error? }]` ([Migração](05-planos-e-cobranca.md#migração-para-o-asaas)) |
| POST | `/billing/monthly/document` | `billing.manage` | `{ cpfCnpj }` (com ou sem máscara; dígitos verificadores conferidos): grava em `tenants.document` e migra para o Pix automático na hora. `{ enrolled }`. Cobrança por Pix escondida dos clientes = 400 |
| GET/PUT | `/billing/monthly/settings` | super_admin | Cobrança por Pix liberada para os clientes: `{ asaasConfigured, clientBilling, autoEnroll }`; `PUT { clientBilling: boolean }` ([Liberar para os clientes](05-planos-e-cobranca.md#liberar-para-os-clientes)) |
| GET | `/billing/pix/:paymentId/qr.png?s=` | pública (URL assinada) | PNG do QR Pix da cobrança, usado no e-mail de lembrete. Assinatura errada = 404 |
| GET | `/billing/asaas/pending` | `billing.manage` | `{payment}`: cobrança em aberto mais antiga (vencida primeiro), com QR PIX — botão "Pagar" da tela |
| GET | `/billing/dues` | `billing.manage` | Painel de vencimentos: `{billingType, online, summary: {totalMonth, overdueCount, overdueAmount, nextDue}, rows[{key, kind: 'group'\|'member'\|'company', companyId, name, plan, cycle, status, state: 'ok'\|'due_soon'\|'overdue'\|'free', daysToDue, amount, dueDate, units, payable, reason, openChargeId}]}` |
| POST | `/billing/dues/pay` | `billing.manage` | `{keys: string[], cpfCnpj?}` → `{payment}` (mesmo formato do checkout, com QR). Cobrança única no Asaas (boleto/PIX) das linhas; valores recalculados na API. 400 com `code: 'document_required'` se faltar CPF/CNPJ |
| GET | `/billing/asaas/payments/:id?pix=1` | `billing.manage` | Situação da cobrança consultada no Asaas (polling do modal). Paga = aplica o mesmo efeito do webhook. Cobrança de outro cliente = 404 |
| **Relatórios** | | | |
| GET | `/reports/overview?from=&to=&tagIds=a,b&agentId=` | todos | Visão pronta. `from`/`to` = instantes ISO (a tela manda o início do dia local; `to` exclusivo). `tagIds` (conversa com a tag, ou encerramento marcado com ela) e `agentId` (conversa com o consultor; em encerramento, quem encerrou **ou** quem atendeu o atendimento que a automação encerrou — `targetId`; em venda, quem vendeu) valem para tudo: KPIs (conversas, fila agora, 1ª resposta média, % encerradas, msgs in/out, comprou/não comprou/taxa de conversão) + séries por dia/atendente/origem/campanha/tag/status + `sales` (tabela `sales`, pelo `closedAt`): `{total, count, avgTicket, byDay[{label,value}], byAgent[{label,value,count,avgTicket}], bySource[{source: asaas\|manual\|close, value, count}] (Pix automático × orçamento pago por fora × informada no encerramento), refunds{count, value} (estornadas no período, pelo `refundedAt` — fora do `total`)}`. KPIs `won`/`revenue` pela régua de vendas (`common/reports/sales-base.ts`: "Comprou" + orçamento pago sem encerramento − estornos) + `lostReasons[{label,value}]` (encerramentos `lost` do período por tag do encerramento, de `conversation_events.tagIds` — um encerramento com duas tags conta nas duas; evento sem tags cai no texto antigo de `reason` sem o sufixo "· encerrado em massa", vazio = "(sem tag)") |
| GET | `/reports/sales/details?startDate=&endDate=&userId=&tagIds=a,b&contactId=&phone=&customerName=&search=&page=&pageSize=` | `reports.view` | Detalhamento da tabela `sales` (pelo `closedAt`; `endDate` exclusivo, padrão últimos 30 dias; `tagIds` = conversa da venda com a tag). `search` casa nome do cliente, número (dígitos, ≥3) ou produto (`products` e `items[].description`). Paginado (`pageSize` ≤ 100, padrão 25), mais recente primeiro. Retorna `{page, pageSize, total, summary{count, revenue, avgTicket, itemsSold}, agents[{id,name}], rows[{id, closedAt, amount, conversationId, contact{id,name,phone,phoneFormatted}, user{id,name}\|null, items[{description,value}], notes}]}`. Venda em texto livre vem como 1 item (`products` + total) e conta 1 em `itemsSold` |
| GET | `/reports/satisfaction?from=&to=&scale=&surveyId=&agentId=&scoreMin=&scoreMax=&onlyComments=1&page=&pageSize=` | `reports.view` | **Satisfação** ([doc](pesquisa-de-satisfacao.md#relatório)): pesquisas enviadas no período (sem `failed`) numa escala (ausente = a mais usada). Retorna `{scale, scales[{scale,count}], totals{sent, answered, declined, waiting, noResponse, responseRate, declineRate, avg, satisfiedPct, nps, distribution[{score,count}], failed}, byAgent[{agentId, name, …mesmos indicadores}], extraQuestions[{questionId, question, scale, answered, avg, satisfiedPct, nps, distribution}], comments{total, page, pageSize, rows[{id, score, comment, answeredAt, sentAt, surveyName, agent, conversationId, contact}]}}`. `agentId` filtra totais e feedbacks; nota e `onlyComments` (padrão 1) só os feedbacks |
| GET | `/reports/goals?month=` · `/sales-goals/:month` | ver [metas.md](metas.md) | Metas mensais e progresso (recurso `consultant_ranking`) |
| GET | `/reports/ranking-consultants?from=&to=&tagIds=a,b` | `reports.view` | **Ranking de consultores**: encerramentos (`conversation_events` `closed`, sem os internos e os do sistema — ator nulo) do período por quem encerrou. Por consultor: `closed` (concluídos + orçamentos pagos ainda sem encerramento), `won` e `revenue` pela régua de vendas (`common/reports/sales-base.ts`: "Comprou" + pago sem encerramento − estornos), `conversionRate` = `won ÷ closed × 100`, `avgHandleMin` (TMA: do encerramento/reabertura anterior da conversa — ou da criação dela — até o encerramento). `tagIds` = tag do atendimento (escolhida no encerramento, retrato dele ou atual da conversa). Exige o recurso `consultant_ranking`. `satisfaction` por consultor = média da pergunta principal da pesquisa na escala mais respondida (`satisfactionScale`), com `nps` na escala de 10. Ordenado pela **pontuação** (`score` 0–100, [Metas › Ranking](metas.md#ranking)); empate → faturamento → vendas. Retorna `{period, satisfactionScale, weights, totals{closed, won, revenue, conversionRate}, ranking[{position, userId, name, closed, won, revenue, conversionRate, avgHandleMin, satisfaction, score, scoreParts{revenue, won, conversion, satisfaction, handleTime}}]}`. Pesos: `PATCH /settings {rankingWeights}` (`settings.manage`; 0–100 cada, `null` = padrão) |
| GET | `/reports/attendances?startDate=&endDate=&outcome=won\|lost\|none&tagIds=a,b&reason=&userId=&search=&page=&pageSize=` | `reports.view` | **Auditoria**: cada encerramento (evento `closed`) do período, mais recente primeiro. `closeReasonId` = motivo; `tagIds` = tags do atendimento (`tagIds` + `tagSnapshot` do encerramento); `reason` = motivo em texto de encerramento antigo sem cadastro; `userId` = consultor: quem encerrou, ou quem atendeu o atendimento que a automação encerrou (`targetId`); `search` = nome ou número. Retorna `{page, pageSize, total, summary{count, won, lost}, agents, rows[{id, closedAt, startedAt (encerramento anterior da conversa; null = desde o começo), conversationId, outcome, value, tags[{id,name,color}], closeReason{id,name,color}\|null, stage{id,name,color}\|null (etapa do Kanban no encerramento), reason, messages (na janela), contact, user, owner (encerrado pela automação: quem atendeu — a tela mostra "Fulano · robô")}]}` |
| GET | `/campaigns` | `campaigns.manage` + recurso `campaigns` | Transmissões (até 200, mais recentes) com `stats{total, pending, sent, delivered, read, failed, skipped}`, `number{label, provider}`, `pauseReason`, `riskAcceptedAt` ([Envio › Transmissão](envio.md#transmissão)) |
| GET | `/campaigns/:id` | idem | Uma transmissão + `daily{sent, limit}` (teto do número em 24h; `null` na Meta) + `problemas[{contato, status, motivo}]` (até 50) |
| POST | `/campaigns/preview` | idem | Público `{all?, tagIds?, closingTagIds?, closingFrom?, closingTo?, lastOutcome?: 'won'\|'lost', agentId?, contactIds?, phones?, groupIds?}` → `{total, novos, invalidos, optOut, excedeu, max, groups}`. Não cria nada. `groupIds` = grupos autorizados ([Grupos restritos](grupos.md)) |
| POST | `/campaigns` | idem | `{name, numberId, text?, mediaKey?, mediaType?, mediaName?, template?: {name, language, header?, body?}, startAt?, businessHoursOnly?, audience}` → rascunho com o público materializado. Meta: `template` obrigatório (conferido); QR: texto e/ou anexo, horário de funcionamento forçado. Sem critério de público = 400; >20.000 = 400 |
| GET | `/groups?numberId=` | `numbers.manage` ou `campaigns.manage` | Grupos do WhatsApp listados e se estão autorizados ([Grupos restritos](grupos.md)) |
| POST | `/groups/sync` | `numbers.manage` | `{numberId}` → busca os grupos do número (só QR, conectado); grupo novo nasce desmarcado |
| PATCH | `/groups/:id` | `numbers.manage` | `{authorized}` — opt-in do grupo como destino de transmissão |
| PATCH | `/groups/:id/inbox` | `numbers.manage` + recurso `groups_inbox` | `{inbox}` — mostra o grupo nas conversas, como chat livre ([Grupos nas conversas](grupos.md#grupos-nas-conversas)) |
| POST | `/campaigns/:id/start` | idem | `{acceptRisk?}` — QR exige o aceite na 1ª vez (`400 qr_risk_not_accepted`); agenda se `startAt` futuro. Emite `campaign` |
| POST | `/campaigns/:id/status` | idem | `{status: 'paused'\|'running'\|'canceled'}` — pausar, retomar (limpa `pauseReason`), cancelar. Emite `campaign` |
| POST | `/reports/run` | todos | Executa um `ReportDefinition` (filtros: `tagIds`, `status`, `numberId`, `origin`, `agentId` — consultor: dono da conversa, ou quem encerrou nas métricas de venda; `groupBy: 'company'` = por empresa) |
| GET/POST | `/conversations/:id/secure-media` (+ `POST …/:mediaId/revoke`, público `GET /secure-media/public/:hash`) | todos | Foto protegida: mídia atrás de um link com validade; o painel envia só o texto com o link. Ver [Foto protegida](foto-protegida.md) |
| GET | `/reports/companies/options` | todos | Empresas do filtro da página de relatórios: `[{ id, name, removed }]` (ativas que a pessoa opera + removidas com histórico, para quem enxerga todas). Todas as rotas de relatório aceitam `companyId` (`all` ou id; no `POST /reports/run`, no corpo) — sem ele vale o seletor do menu |
| GET | `/reports/companies?from=&to=&tagIds=&agentId=` | todos | Comparativo por empresa: `{ rows: [{ companyId (null = sem empresa), name, conversations, closed, waitingNow, avgFirstResponseMin, won, lost, revenue, avgTicket, winRate }] }`, uma linha por empresa que a pessoa opera. Todos os relatórios respeitam o seletor de empresa (`x-company-id`) — ver [Empresas](empresas.md#relatórios) |
| GET / POST / DELETE | `/reports/saved[/:id]` | todos | Relatórios salvos |
| **Webhooks** (sem auth de usuário) | | | |
| GET | `/webhooks/meta` | — | Verificação da Meta (`hub.challenge`) |
| POST | `/webhooks/meta` | — | Eventos Meta (HMAC) |
| POST | `/webhooks/evolution` | — | Eventos Evolution (token de instância) |
| POST | `/webhooks/stripe` | — | Eventos Stripe (assinatura `stripe-signature`) |
| POST | `/webhooks/asaas` | — | Eventos Asaas (header `asaas-access-token` = `ASAAS_WEBHOOK_TOKEN`; 403 se não bater) |

### Contatos isentos de ticket e chat interno

Rotas em [Contatos isentos](contatos-isentos.md#api) (`/ignored-contacts`, `settings.manage`; `GET /conversations?free=1` = Conversas livres, nos filtros da lista) e
[Chat interno](chat-interno.md#api) (`/internal-chat/*`; auditoria com `internal_chat.audit`).

### Escalas, plantões e acessos temporários (`team.manage`)

Rotas em [Escalas](escalas.md#api): `/work-schedules`, `/work-schedules/team`, `/work-schedules/overrides`, `PATCH /users/:id/schedule` e `/users/temporary`. Login e refresh devolvem `403` com `code` `FOR_OUT_OF_SCHEDULE` (fora da escala, sem liberação — com `requestToken` para o pedido de autorização) ou `ACCOUNT_EXPIRED` (conta temporária vencida).

### Contatos: importar e exportar (`contacts.import_export`)

| Método | Rota | Quem | Descrição |
|---|---|---|---|
| GET | `/contacts/export` | `contacts.import_export` | CSV (`;`, UTF-8 com BOM — abre no Excel) da base inteira do cliente (até 100 mil): Nome, Telefone, E-mail, Documento, Endereço, Observação 1/2, Tags, Descadastrado, Criado em + uma coluna por campo personalizado |
| POST | `/contacts/import` | `contacts.import_export` | `{csv?: string, rows?: string[][], overwrite?: boolean, dryRun?: boolean}` — `csv` é o conteúdo do .csv (`;`, `,` ou tabulação); `rows` é o .xlsx lido no navegador. Até 5.000 linhas. Reconhece o cabeçalho (o mesmo da exportação, ou nome/telefone/celular/whatsapp/e-mail/cpf…); sem cabeçalho, acha a coluna de telefone sozinho. Telefone normalizado (sem DDI = +55), casa com o contato existente com ou sem o nono dígito. Sem `overwrite`: só completa campos vazios e nunca troca nome `manual`. Tags só as que já existem (as outras voltam em `unknownTags`). `dryRun` = só o relatório `{created, updated, unchanged, duplicates, invalid[], invalidCount, unknownTags}` |

Lógica pura em `apps/api/src/modules/contacts/contacts-io.ts` (testes em `test/contacts-io.test.ts`).

## Exemplos

**Criar número QR e pegar o QR:**
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

Métricas e a janela de tempo de cada uma — a conversa é **uma por pessoa** e reabre a cada retorno, então nada é filtrado pela data de criação da conversa, exceto a 1ª resposta:

| Métrica | Conta | Cai no período pela data de |
|---|---|---|
| `conversations` | **atendimentos iniciados** (conversa nova + reaberta — evento `reopened`) | início do atendimento |
| `messages_in` / `messages_out` | mensagens recebidas / enviadas (sem notas internas) | mensagem |
| `avg_first_response_min` | minutos até a 1ª resposta | criação da conversa |
| `closed` | **atendimentos encerrados** (evento `closed`) | encerramento |
| `revenue` / `won` / `lost` / `win_rate` | vendas / Comprou / Não comprou / taxa, dos encerramentos | encerramento |

Agrupamentos: `day`, `week`, `month`, `tag`, `status`, `number`, `agent`, `origin`, `campaign` (título do anúncio). Nas métricas de encerramento, `agent` = **quem encerrou** e `tag` = tags escolhidas **naquele encerramento** (`e.tagIds`; a conversa perde as de encerramento ao reabrir); nas outras, `agent` = com quem a conversa está e `tag` = tags da conversa. Filtros: `tagIds` (em encerramento: escolhida nele ou na conversa), `status`, `numberId`, `origin`, `agentId`.

Visão pronta (`GET /reports/overview`): "Atendimentos no período" = soma dos iniciados por dia; "Atendimentos por atendente" = `closed` por quem encerrou; filtro de tag nas vendas (`sales`) casa a tag da conversa ou a escolhida no encerramento "Comprou" da venda (evento gravado na mesma operação).

## Erros

Formato padrão do Nest: `{ statusCode, message, error }`. Códigos relevantes:

| Código | Quando |
|---|---|
| 400 | Validação (campo inválido/desconhecido), janela 24h expirada, conversa encerrada, número desconectado |
| 401 | Token ausente/expirado, webhook não autenticado |
| 403 | `code: SHIFT_ENDED` = sessão no modo fim de turno ([Escalas](escalas.md#fim-de-turno)); role insuficiente, limite do plano, assinatura suspensa, transferir/devolver conversa que não é sua; login/refresh fora da escala (`code: FOR_OUT_OF_SCHEDULE`) ou de conta temporária vencida (`code: ACCOUNT_EXPIRED`) — ver [Escalas](escalas.md) |
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

Vale para `search` em `GET /conversations`, `q` em `GET /conversations/contacts`, `q` em `GET /conversations/start/contacts` e `q` em `GET /numbers/:id/phonebook` (helper `common/text-search.ts`):

- **sem acento e sem diferença de maiúsculas** — "joao" acha "João";
- **por palavras, em qualquer ordem** — "silva maria" acha "Maria da Silva" (cada palavra é um AND; até 5);
- **telefone com ou sem máscara** — termo só com dígitos/`()+-.`/espaço vira um token de dígitos: "(62) 99999-9999" e "629999" acham `5562999999999`;
- contatos: nome, e-mail e telefone; agenda do celular: nome e telefone.

Roda no banco sobre a coluna gerada `searchText` (texto dobrado: minúsculo, sem acento) com índice GIN `pg_trgm`, então escala com a base. A dobra do termo em JS (`foldSearch`) e a da coluna (`translate` na migração `contact_search`) precisam continuar iguais.


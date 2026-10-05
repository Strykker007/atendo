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
| POST | `/tenants` | super_admin | Cria cliente + assinatura + admin |
| PATCH | `/tenants/:id` | super_admin | `name`, `isActive`, `planId`, `subscriptionStatus` (ajuste manual sem Stripe) |
| POST | `/tenants/:id/impersonate` | super_admin | `{accessToken, tenant}` — "entrar como" (token com o tenant, papel admin, `impersonatorId`) |
| GET | `/tenants/me/agents` | todos | Atendentes do meu tenant (todos podem listar para transferir) |
| POST | `/tenants/me/agents` | tenant_admin, manager | Cria atendente (`role: agent`) ou gerente (`role: manager`, só admin); respeita `maxAgents` |
| PATCH | `/tenants/me/agents/:id` | tenant_admin | Nome / ativo / `password` (redefine e revoga sessões) |
| **Números** | | | |
| GET | `/numbers` | todos | Números do tenant |
| POST | `/numbers` | tenant_admin | Cria e conecta (respeita `maxNumbers`) |
| PUT | `/numbers/:id/provider` | tenant_admin | **Troca de provider** |
| POST | `/numbers/:id/connect` | tenant_admin | Reconecta / QR novo |
| PATCH | `/numbers/:id` | tenant_admin | Label / cor (`color`, `#rrggbb`) / ativo |
| DELETE | `/numbers/:id` | tenant_admin | Remove (cascade em conversas) |
| **Conversas** | | | |
| GET | `/conversations?status=&numberId=&departmentId=&tagIds=a,b&search=&origin=&assigneeId=&sort=&cursor=` | todos | Lista por cursor. `departmentId` = id ou `none` (sem departamento), sempre interseccionado com o escopo de departamentos do usuário ([Departamentos](departamentos.md)). Em `in_progress`, atendente vê só as suas; admin vê todas ou filtra por `assigneeId`. `sort=waiting` ordena por quem espera resposta há mais tempo (`awaitingSince` asc, já respondidas por último) |
| GET | `/conversations/counts?numberId=&departmentId=` | todos | `{waiting, in_progress, closed, in_progress_mine, in_progress_all}` (`in_progress` já respeita a visão do usuário) |
| GET | `/conversations/:id` | todos | Uma conversa (contato, tags, atendente, número) |
| GET | `/conversations/:id/messages?cursor=` | todos | Mensagens (mais recentes primeiro, 50); `mediaUrl` já vem assinada. **Nada é apagado**: o painel carrega a última página e busca o passado conforme a pessoa rola, com `cursor` = id da última linha recebida |
| POST | `/conversations/:id/messages` | todos | Envia: `{type:'text', text}` ou `{type:'image'|'audio'|'video'|'document', mediaKey, text?}` ou template. Sai **sempre** pelo número da conversa (nenhum campo escolhe o número; campo extra = 400). `expectedNumberId?` = canal mostrado na tela: divergiu → 409 `{code:'number_changed'}` sem enviar. Número inativo/de outro tenant ou desconectado → 422. `idempotencyKey?` (até 100 caracteres, uma por envio): repetir com a mesma chave devolve a mensagem já criada, sem enfileirar de novo ([Envio](envio.md#deduplicação)) |
| POST | `/conversations/:id/claim` | todos | Assumir (atômico; 409 se outra pessoa assumiu) |
| POST | `/conversations/:id/transfer` | dono ou admin | `{agentId}` |
| POST | `/conversations/:id/release` | dono ou admin | Devolve à fila (waiting, sem dono) |
| PATCH | `/conversations/:id/department` | dono, `transfer_any` ou qualquer um se sem dono | `{departmentId: uuid \| null}` — vai para a fila (Aguardando, sem dono) do departamento; encerrada só troca. Grava `department_changed` |
| POST | `/conversations/:id/messages/:messageId/resend` | todos | "Tentar novamente": mensagem `failed` volta para `pending` no fim da fila da conversa. 409 se já foi reenviada (clique duplo) ou se a conversa mudou de canal (`number_changed`); número desconectado → 400 |
| POST | `/conversations/:id/messages/:messageId/react` | todos | Reação do atendente `{ emoji }` (vazio = retirar). Manda pelo provider e **só grava se ele aceitar**; emite `message` no socket. Recusa: mensagem sem `externalId`/pendente/falha, conversa encerrada, número desconectado, conversa de outro atendente (409), fora da janela de 24h (Meta). Não assume a conversa e não passa pelo `UsageService` |
| POST | `/conversations/:id/messages/:messageId/forward` | todos | Encaminhar `{ targetConversationIds: uuid[] }` (1–5). Cada destino é um `send` normal marcado `forwarded: true` (quota, janela da Meta, "responder = assumir", ledger). Mídia reaproveita o arquivo do storage; localização vira texto com link do Maps, contato vira nome + telefone, botões/lista viram o texto. Recusa figurinha e mídia ainda não baixada. Destino fora do escopo de números do usuário = "não encontrada". Devolve `{ sent: Message[], failed: { conversationId, error }[] }` — falha num destino não derruba os outros |
| PATCH | `/conversations/:id/status` | todos | `waiting | in_progress | closed` |
| POST | `/conversations/bulk/close` | todos | `{ids[], outcome?, reason?}` — encerra até 200. Devolve `{closed, ignored}`. O recorte (números do usuário; atendente comum só o que é dele ou está sem dono) é feito no service, porque o `ConversationScopeGuard` olha `:id` e aqui a lista vem no corpo. Sem valor de venda e sem fluxo, de propósito |
| GET | `/conversations/:id/events` | todos | Histórico do atendimento: `claimed`, `transferred`, `released`, `closed`, `reopened`, `bot_paused`, `bot_resumed`, `department_changed` (`reason` "A → B"), com ator, alvo, desfecho congelado e data |
| POST | `/conversations/:id/bot/pause` | todos (feature `flows`) | Pausa o robô só nesta conversa. Body `{ minutes?: 30 \| 60 \| 240 \| null }` (nulo = até retomar). Interrompe o fluxo em andamento. Ver [fluxos › Pausar o robô](fluxos.md#pausar-o-robô-na-conversa) |
| POST | `/conversations/:id/bot/resume` | todos (feature `flows`) | Retoma o robô (o fluxo interrompido não volta) |
| PATCH | `/conversations/:id/tags` | todos | `{tagIds: []}` substitui as tags. A principal se mantém se continuar na lista; senão a primeira tag de coluna (ordem do Kanban) assume. Emite `conversation` |
| PATCH | `/conversations/:id/primary-tag` | todos | `{tagId: uuid \| null}` troca a tag principal (mover card no Kanban). A antiga vira secundária; a nova entra se faltava. `null` = "Sem etapa". 400 se a tag não for `isKanban`. Emite `conversation` |
| PATCH | `/conversations/contacts/:contactId/tags` | todos | `{tagIds}` substitui as tags **do contato** (permanentes) |
| POST | `/conversations/:id/read` | todos | Zera não-lidas. Também assina o "digitando…" do contato no provider (Evolution; no máx. 1×/2 min por contato, sem esperar a resposta) |
| **Departamentos** | | | |
| GET | `/departments` | todos | Com participantes e nº de conversas abertas |
| POST / PATCH / DELETE | `/departments[/:id]` | `team.manage` | `{name, description?, color?, isActive?, userIds?}` (`userIds` substitui). Excluir deixa as conversas sem departamento. Ver [Departamentos](departamentos.md) |
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
| GET / PATCH | `/settings` | todos / `settings.manage` | Fuso, `attendanceActive`, fluxos padrão, boas-vindas (`welcomeEnabled`, `welcomeMessages`, `welcomeMode`). GET traz `isOpenNow`, `currentBand`, `nextOpenLabel` |
| GET / POST | `/settings/schedules` | todos / `settings.manage` | Quadros de horários. POST `{ name, timezone?, config?, copyFromId? }` |
| PUT / DELETE | `/settings/schedules/:id` | `settings.manage` | `{ name?, timezone?, config? }` validado (`validateSchedule`); devolve `renamedConditions` (faixa renomeada atualiza as condições dos fluxos); o padrão não pode ser excluído |
| POST | `/settings/schedules/:id/default` | `settings.manage` | Torna o quadro padrão |
| PUT | `/settings/numbers/:numberId/schedule` | `settings.manage` | `{ scheduleId \| null }` — quadro próprio do número. Ver [Horários](horarios.md#api) |
| **Mídia** | | | |
| POST | `/uploads` | todos | multipart `file` → `{key, url, mimeType, fileName, size}` |
| GET | `/media/*path?exp=&sig=` | — (assinatura) | Serve o arquivo se a assinatura for válida |
| **Billing** | | | |
| GET | `/billing/plans` | todos | Planos ativos com limites e `stripePriceId` |
| GET | `/billing/plans/all` | super_admin | Catálogo completo (inclui inativos) com `subscribers` e `billingEnabled` |
| POST | `/billing/plans` | super_admin | Cria plano. `{name, priceMonth, billingModel, limits}` — `limits` validado campo a campo. Cria produto+preço no Stripe quando a cobrança está ligada |
| PATCH | `/billing/plans/:id` | super_admin | Edita. Mudar `priceMonth` cria um preço novo no Stripe e arquiva o antigo (preço é imutável lá). `applyToExisting: {mode: 'never'\|'scheduled'\|'now', days?}` decide o que acontece com quem já assina — padrão `never` |
| DELETE | `/billing/plans/:id` | super_admin | Só sem assinantes (senão 400). Arquiva o produto no Stripe |
| GET | `/billing/invoices` | todos | Faturas do tenant (espelho do Stripe) |
| POST | `/billing/checkout` | tenant_admin | `{planId}` → `{url}` do Checkout (ou troca com proration se já assina) |
| POST | `/billing/portal` | tenant_admin | `{url}` do Customer Portal |
| GET | `/billing/margin?period=` | super_admin | Margem por cliente |
| GET | `/billing/finance?months=` | super_admin | Financeiro completo: MRR/ARR, ativos/teste/pendentes/suspensos, em atraso, série mensal (faturado, recebido, atrasado, excedente, custo, novos, cancelados), por plano, assinaturas, faturas |
| POST | `/billing/sync-plans` | super_admin | Cria Products/Prices no Stripe |
| GET | `/billing/usage` | todos | Uso do mês (mensagens, templates, números, atendentes), limites, status, mensalidade, excedente, fim do período |
| **Relatórios** | | | |
| GET | `/reports/overview?from=&to=` | todos | Visão pronta: KPIs (conversas, fila agora, 1ª resposta média, % encerradas, msgs in/out) + séries por dia/atendente/origem/campanha/tag/status |
| POST | `/reports/run` | todos | Executa um `ReportDefinition` |
| GET / POST / DELETE | `/reports/saved[/:id]` | todos | Relatórios salvos |
| **Webhooks** (sem auth de usuário) | | | |
| GET | `/webhooks/meta` | — | Verificação da Meta (`hub.challenge`) |
| POST | `/webhooks/meta` | — | Eventos Meta (HMAC) |
| POST | `/webhooks/evolution` | — | Eventos Evolution (token de instância) |
| POST | `/webhooks/stripe` | — | Eventos Stripe (assinatura `stripe-signature`) |

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

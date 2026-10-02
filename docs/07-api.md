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
| PATCH | `/numbers/:id` | tenant_admin | Label / ativo |
| DELETE | `/numbers/:id` | tenant_admin | Remove (cascade em conversas) |
| **Conversas** | | | |
| GET | `/conversations?status=&numberId=&tagIds=a,b&search=&origin=&assigneeId=&sort=&cursor=` | todos | Lista por cursor. Em `in_progress`, atendente vê só as suas; admin vê todas ou filtra por `assigneeId`. `sort=waiting` ordena por quem espera resposta há mais tempo (`awaitingSince` asc, já respondidas por último) |
| GET | `/conversations/counts?numberId=` | todos | `{waiting, in_progress, closed, in_progress_mine, in_progress_all}` (`in_progress` já respeita a visão do usuário) |
| GET | `/conversations/:id` | todos | Uma conversa (contato, tags, atendente, número) |
| GET | `/conversations/:id/messages?cursor=` | todos | Mensagens (mais recentes primeiro, 50); `mediaUrl` já vem assinada. **Nada é apagado**: o painel carrega a última página e busca o passado conforme a pessoa rola, com `cursor` = id da última linha recebida |
| POST | `/conversations/:id/messages` | todos | Envia: `{type:'text', text}` ou `{type:'image'|'audio'|'video'|'document', mediaKey, text?}` ou template |
| POST | `/conversations/:id/claim` | todos | Assumir (atômico; 409 se outra pessoa assumiu) |
| POST | `/conversations/:id/transfer` | dono ou admin | `{agentId}` |
| POST | `/conversations/:id/release` | dono ou admin | Devolve à fila (waiting, sem dono) |
| POST | `/conversations/:id/messages/:messageId/resend` | todos | Reenvia mensagem com status `failed` |
| PATCH | `/conversations/:id/status` | todos | `waiting | in_progress | closed` |
| POST | `/conversations/bulk/close` | todos | `{ids[], outcome?, reason?}` — encerra até 200. Devolve `{closed, ignored}`. O recorte (números do usuário; atendente comum só o que é dele ou está sem dono) é feito no service, porque o `ConversationScopeGuard` olha `:id` e aqui a lista vem no corpo. Sem valor de venda e sem fluxo, de propósito |
| GET | `/conversations/:id/events` | todos | Histórico do atendimento: `claimed`, `transferred`, `released`, `closed`, `reopened`, com ator, alvo, desfecho congelado e data |
| PATCH | `/conversations/:id/tags` | todos | `{tagIds: []}` substitui as tags |
| PATCH | `/conversations/contacts/:contactId/tags` | todos | `{tagIds}` substitui as tags **do contato** (permanentes) |
| POST | `/conversations/:id/read` | todos | Zera não-lidas |
| **Tags** | | | |
| GET | `/tags` | todos | Com contagem de conversas |
| POST / PATCH / DELETE | `/tags[/:id]` | tenant_admin | `{name, color}` |
| **Respostas rápidas** | | | |
| GET | `/quick-replies` | todos | Pastas com respostas |
| POST / PATCH / DELETE | `/quick-replies/folders[/:id]` | todos | Pastas |
| POST / PATCH / DELETE | `/quick-replies[/:id]` | todos | Respostas |
| **Mídia** | | | |
| POST | `/uploads` | todos | multipart `file` → `{key, url, mimeType, fileName, size}` |
| GET | `/media/*path?exp=&sig=` | — (assinatura) | Serve o arquivo se a assinatura for válida |
| **Billing** | | | |
| GET | `/billing/plans` | todos | Planos ativos com limites e `stripePriceId` |
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
| POST | `/ai/summary` | `{ conversationId }` → `{ text }` — resumo em tópicos |

`503` = sem fornecedor configurado. `403` = sem a feature no plano, sem quota ou teto de
gasto atingido (a mensagem diz qual).

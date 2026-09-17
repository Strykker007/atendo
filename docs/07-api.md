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
| GET | `/tenants/me/agents` | tenant_admin | Atendentes do meu tenant |
| POST | `/tenants/me/agents` | tenant_admin | Cria atendente (respeita `maxAgents`) |
| PATCH | `/tenants/me/agents/:id` | tenant_admin | Nome / ativo / `password` (redefine e revoga sessões) |
| **Números** | | | |
| GET | `/numbers` | todos | Números do tenant |
| POST | `/numbers` | tenant_admin | Cria e conecta (respeita `maxNumbers`) |
| PUT | `/numbers/:id/provider` | tenant_admin | **Troca de provider** |
| POST | `/numbers/:id/connect` | tenant_admin | Reconecta / QR novo |
| PATCH | `/numbers/:id` | tenant_admin | Label / ativo |
| DELETE | `/numbers/:id` | tenant_admin | Remove (cascade em conversas) |
| **Conversas** | | | |
| GET | `/conversations?status=&numberId=&tagIds=a,b&search=&cursor=` | todos | Lista paginada por cursor |
| GET | `/conversations/counts?numberId=` | todos | `{waiting, in_progress, closed}` para os contadores dos filtros |
| GET | `/conversations/:id` | todos | Uma conversa (contato, tags, atendente, número) |
| GET | `/conversations/:id/messages?cursor=` | todos | Mensagens (mais recentes primeiro, 50); `mediaUrl` já vem assinada |
| POST | `/conversations/:id/messages` | todos | Envia: `{type:'text', text}` ou `{type:'image'|'audio'|'video'|'document', mediaKey, text?}` ou template |
| POST | `/conversations/:id/messages/:messageId/resend` | todos | Reenvia mensagem com status `failed` |
| PATCH | `/conversations/:id/status` | todos | `waiting | in_progress | closed` |
| PATCH | `/conversations/:id/tags` | todos | `{tagIds: []}` substitui as tags |
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
| GET | `/billing/usage` | todos | Uso do mês (mensagens, templates, números, atendentes), limites, status, mensalidade, excedente, fim do período |
| **Relatórios** | | | |
| POST | `/reports/run` | todos | Executa um `ReportDefinition` |
| GET / POST | `/reports/saved` | todos | Relatórios salvos |
| **Webhooks** (sem auth de usuário) | | | |
| GET | `/webhooks/meta` | — | Verificação da Meta (`hub.challenge`) |
| POST | `/webhooks/meta` | — | Eventos Meta (HMAC) |
| POST | `/webhooks/evolution` | — | Eventos Evolution (token de instância) |

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

Métricas: `conversations`, `messages_in`, `messages_out`, `avg_first_response_min`. Agrupamentos: `day`, `week`, `month`, `tag`, `status`, `number`, `agent`. Filtros: `tagIds`, `status`, `numberId`.

## Erros

Formato padrão do Nest: `{ statusCode, message, error }`. Códigos relevantes:

| Código | Quando |
|---|---|
| 400 | Validação (campo inválido/desconhecido), janela 24h expirada, conversa encerrada, número desconectado |
| 401 | Token ausente/expirado, webhook não autenticado |
| 403 | Role insuficiente, limite do plano, assinatura suspensa |
| 404 | Recurso de outro tenant ou inexistente (nunca revelamos qual) |
| 429 | Throttling |

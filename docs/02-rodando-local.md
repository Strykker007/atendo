# 02 — Rodando local

## Pré-requisitos

| Ferramenta | Versão | Como instalar (macOS) |
|---|---|---|
| Node.js | 22+ | `brew install node@22` ou nvm |
| pnpm | 12+ | `corepack enable && corepack prepare pnpm@latest --activate` |
| Docker | qualquer | **Colima** (sem Docker Desktop, sem senha de admin): `brew install colima docker docker-compose` |

### Colima (Docker leve)

```bash
colima start --cpu 2 --memory 4
mkdir -p ~/.docker/cli-plugins
ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose
docker compose version   # deve imprimir a versão
```

Depois de reiniciar o Mac, rode `colima start` de novo antes de subir a infra.

## Passo a passo

```bash
git clone <repo> atendo && cd atendo
pnpm install
```

### 1. Variáveis de ambiente

Existe um `.env.example` na raiz. Copie para `.env` e gere a chave de criptografia:

```bash
cp .env.example .env
sed -i '' "s|^ENCRYPTION_KEY=$|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
```

`apps/api/.env` e `apps/web/.env` são **symlinks** para o `.env` da raiz — um arquivo só para tudo. Se os links não existirem (clone novo), crie:

```bash
ln -sfn ../../.env apps/api/.env && ln -sfn ../../.env apps/web/.env
```

Portas usadas (escolhidas para não colidir com outros projetos na mesma máquina):

| Serviço | Porta | Variável |
|---|---|---|
| Web (Next) | 3000 | — |
| API (Nest) | 4000 | `API_PORT` |
| Postgres do Atendo | **5433** | `DATABASE_URL` |
| Redis | 6379 | `REDIS_URL` |
| Evolution API | 8080 | `EVOLUTION_BASE_URL` |

Mídia recebida/enviada fica em `apps/api/storage/` (driver `local`, grátis). Para produção troque `STORAGE_DRIVER=s3` e preencha as variáveis `S3_*` — ver [03](03-arquitetura.md#storage-de-mídia).

### 2. Infraestrutura

```bash
pnpm infra:up
```

Sobe Postgres, Redis, Evolution API e o Postgres interno da Evolution. Verifique:

```bash
docker compose -f infra/docker-compose.yml --env-file .env ps
curl localhost:8080      # {"status":200,"message":"Welcome to the Evolution API..."}
```

### 3. Banco

```bash
pnpm db:migrate     # cria as tabelas
pnpm db:seed        # planos, preços Meta BR, super admin, tenant demo
```

Usuários criados pelo seed:

| E-mail | Senha | Papel |
|---|---|---|
| `admin@atendo.local` | `admin12345` | super_admin |
| `demo@atendo.local` | `demo12345` | admin do tenant "Loja Demo" (plano Pro) |

### 4. Aplicação

```bash
pnpm dev            # api :4000 + web :3000 juntos (Turborepo)
```

Ou separado, em dois terminais:

```bash
pnpm --filter @atendo/api dev
```
```bash
pnpm --filter @atendo/web dev
```

Abra http://localhost:3000 e entre com `demo@atendo.local / demo12345`.

### 5. Conectar um número (não-oficial)

1. Menu *Números → Novo número*.
2. Nome "Vendas", telefone com DDI (ex.: `5511999998888`), provider *Não-oficial (QR)*.
3. Um QR aparece. No celular: *WhatsApp → ⋮ → Dispositivos conectados → Conectar dispositivo*.
4. O status muda para **Conectado** sozinho (chega pelo WebSocket).
5. Mande uma mensagem de outro celular para esse número: ela aparece em *Conversas → Aguardando*.

## Comandos úteis

| Comando | Faz |
|---|---|
| `pnpm typecheck` | Checa tipos em todos os pacotes |
| `pnpm build` | Build de tudo |
| `pnpm db:studio` | Prisma Studio (navegar no banco) |
| `pnpm db:generate` | Regenera o Prisma Client após mudar o schema |
| `pnpm infra:logs` | Logs dos containers (útil para ver a Evolution) |
| `pnpm infra:down` | Derruba a infra (dados ficam em `infra/volumes`) |
| `pnpm --filter @atendo/shared build` | Recompila os tipos compartilhados (a API importa do `dist`) |

## Erros comuns

**`Variáveis de ambiente inválidas`** ao subir a API — falta alguma variável no `.env`. A mensagem lista quais. `ENCRYPTION_KEY` precisa ter 32 bytes em base64.

**`EADDRINUSE :4000`** — outra coisa está na porta. `lsof -iTCP:4000 -sTCP:LISTEN` mostra quem. Mude `API_PORT` no `.env` **e** `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL`, e o `WEBHOOK_GLOBAL_URL` no compose.

**Front dá `Failed to fetch` / CORS** — o Next cacheou `NEXT_PUBLIC_*` antigas. Pare o web, `rm -rf apps/web/.next`, suba de novo.

**Evolution reinicia com `Can't reach database server`** — subiu antes do banco dela. O compose já tem healthcheck + `restart: unless-stopped`; espere 20 s ou `pnpm infra:up` de novo.

**Evolution loga `401` chamando o webhook** — a API está rejeitando o webhook. Veja [04 — Providers](04-providers-whatsapp.md#autenticação-do-webhook). Acontece se a instância foi criada sem o token HMAC (instâncias antigas): exclua o número e crie de novo.

**`This name "..." is already in use`** ao criar número — a instância já existe na Evolution com outro token. Delete-a: `curl -X DELETE localhost:8080/instance/delete/<nome> -H "apikey: $EVOLUTION_API_KEY"`.

**Testar sem celular** — dá para simular um webhook da Evolution: o corpo precisa de `instance` e `apikey` = HMAC-SHA256(`EVOLUTION_API_KEY`, instanceName). Exemplo em [04](04-providers-whatsapp.md#autenticação-do-webhook).

**Mandei mensagem para o número conectado e nada apareceu** — veja `pnpm infra:logs` (serviço `evolution`). Se aparecer `Request failed with status code 413`, o corpo do webhook passou do limite da API (`useBodyParser` em `main.ts`, hoje 30 MB — a Evolution manda mídia em base64). Se aparecer `401`, é a autenticação do webhook (instância criada sem o token HMAC — exclua e recrie o número). Se não aparecer nada, a instância não está `open`: `curl localhost:8080/instance/fetchInstances -H "apikey: $EVOLUTION_API_KEY"`.

**Escaneei o QR e o modal não mudou para "Conectado"** — o status chega por socket e, como reserva, o modal consulta a API a cada 3 s enquanto está aberto. Se mesmo assim não mudar, o webhook `connection.update` não está chegando (ver item acima).

**Responder dá "Connection Closed"** e o log da Evolution repete `stream:error … conflict type=replaced` — a sessão do WhatsApp foi substituída (QR escaneado duas vezes, ou "Gerar novo QR" depois de já ter lido). Solução: no celular remova o dispositivo "Evolution/Chrome" em *Dispositivos conectados*; na Evolution apague a instância (`curl -X DELETE localhost:8080/instance/delete/<nome> -H "apikey: $EVOLUTION_API_KEY"`); em *Números* clique *Conectar (QR)* e escaneie **uma vez só**. O `connect()` do adapter já não reabre uma sessão que está `open`, então clicar de novo não causa mais isso.

**Conectou e logo depois voltou para "Aguardando QR"** — o celular removeu o dispositivo (`conflict: device_removed` no log da Evolution). Costuma acontecer ao apagar o dispositivo "antigo" em *Dispositivos conectados* depois de já ter escaneado o novo: os dois aparecem com o mesmo nome. Ordem certa: **primeiro** remova os dispositivos antigos no celular, **depois** escaneie. Para reconectar basta *Conectar (QR)* — o adapter descarta a sessão morta e gera QR novo.

**QR expirou / status voltou para Desconectado** — normal, o QR vale ~40 s. Clique em *Conectar (QR)* de novo.

#!/bin/bash
# Prepara o ambiente de produção a partir do domínio.
#
# Uso: bash scripts/prepare-prod.sh seudominio.com.br
#
# Gera .env.production com segredos aleatórios e acerta os domínios no Caddyfile.
# Não sobrescreve nada que já exista — rode à vontade.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN=${1:?informe o domínio, ex.: bash scripts/prepare-prod.sh atendo.com.br}
APP="app.$DOMAIN"
API="api.$DOMAIN"
ENVFILE=.env.production

if [ -f "$ENVFILE" ]; then
  echo "⚠  $ENVFILE já existe — não vou sobrescrever."
  echo "   Apague-o antes se quiser gerar de novo (isso invalida sessões e credenciais salvas)."
  exit 1
fi

secret() { openssl rand -base64 32 | tr -d '\n'; }
# ENCRYPTION_KEY precisa ser exatamente 32 bytes em base64 (AES-256-GCM)
enckey() { openssl rand -base64 32 | tr -d '\n'; }

PG_PW=$(secret); EVO_DB_PW=$(secret); EVO_KEY=$(secret)

cp .env.production.example "$ENVFILE"
set_var() {
  # substitui a linha VAR=... preservando o resto do arquivo
  python3 - "$ENVFILE" "$1" "$2" <<'PY'
import re, sys
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
pat = re.compile(rf'^{re.escape(key)}=.*$', re.M)
s = pat.sub(lambda _: f'{key}={val}', s) if pat.search(s) else s + f'\n{key}={val}\n'
open(path, 'w').write(s)
PY
}

set_var NODE_ENV production
set_var POSTGRES_USER atendo
set_var POSTGRES_PASSWORD "$PG_PW"
set_var DATABASE_URL "postgresql://atendo:$PG_PW@postgres:5432/atendo?schema=public"
set_var REDIS_URL "redis://redis:6379"
set_var API_PORT 4000
set_var API_PUBLIC_URL "https://$API"
set_var WEB_ORIGIN "https://$APP"
set_var NEXT_PUBLIC_API_URL "https://$API"
set_var NEXT_PUBLIC_WS_URL "https://$API"
set_var JWT_ACCESS_SECRET "$(secret)"
set_var JWT_REFRESH_SECRET "$(secret)"
set_var ENCRYPTION_KEY "$(enckey)"
set_var EVOLUTION_BASE_URL "http://evolution:8080"
set_var EVOLUTION_API_KEY "$EVO_KEY"
set_var EVOLUTION_DB_PASSWORD "$EVO_DB_PW"
set_var META_WEBHOOK_VERIFY_TOKEN "$(secret)"
set_var LOG_FORMAT json
set_var MAIL_FROM "Atendo <nao-responda@$DOMAIN>"

# domínios no Caddy
python3 - "$APP" "$API" <<'PY'
import re, sys
app, api = sys.argv[1], sys.argv[2]
p = 'infra/Caddyfile'
s = open(p).read()
s = re.sub(r'^app\.[^\s{]+', app, s, count=1, flags=re.M)
s = re.sub(r'^api\.[^\s{]+', api, s, count=1, flags=re.M)
open(p, 'w').write(s)
PY

chmod 600 "$ENVFILE"

cat <<TXT

✅ $ENVFILE gerado e infra/Caddyfile apontando para:
   painel  https://$APP
   API     https://$API

Faltam SÓ as chaves de terceiros (opcionais para subir, necessárias para cobrar/IA):
   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET   cobrança
   RESEND_API_KEY                             e-mails (convite funciona sem)
   AI_PROVIDER, AI_API_KEY                    copiloto e IA nos fluxos
   BACKUP_REMOTE + infra/backup/rclone.conf   backup fora do servidor

Antes de subir, aponte no DNS (registro A) para o IP do servidor:
   $APP   →  IP
   $API   →  IP

Depois, no servidor:
   docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
   docker compose -f infra/docker-compose.prod.yml --env-file .env.production exec api npx prisma db seed

⚠  Guarde o $ENVFILE. Perder ENCRYPTION_KEY torna ilegíveis as credenciais dos números
   já cadastrados — todos precisariam ser reconectados.
TXT

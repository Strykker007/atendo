#!/bin/bash
# Envia o código para o servidor e sobe a stack de produção.
#
# Uso: bash scripts/deploy.sh ubuntu@IP [caminho-da-chave]
#
# Não toca em .env.production nem em infra/volumes: segredos e dados vivem
# só no servidor. Rodar duas vezes é seguro.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=${1:?informe o destino, ex.: bash scripts/deploy.sh ubuntu@1.2.3.4}

# Produção = branch main, commitada. O rsync manda a PASTA, não um commit: sem esta trava,
# deploy feito da develop (ou com arquivo pela metade) sobe código que não está em lugar
# nenhum do git. Emergência consciente: DEPLOY_ANY_BRANCH=1 bash scripts/deploy.sh …
if [ "${DEPLOY_ANY_BRANCH:-}" != "1" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  [ "$BRANCH" = "main" ] || { echo "✖ Deploy só da main (você está em '$BRANCH'). Faça o merge da develop na main antes." >&2; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "✖ Há alterações não commitadas — elas iriam para produção sem estar no git." >&2; exit 1; }
fi
KEY=${2:-$HOME/.ssh/atendo-prod.key}
SSH="ssh -i $KEY -o BatchMode=yes"

# --filter=':- .gitignore' faz o rsync obedecer o .gitignore. Sem isso, infra/volumes vai
# junto e o Postgres do servidor sobe com o banco de desenvolvimento dentro — inclusive a
# sessão do WhatsApp, que duas instâncias não podem compartilhar.
echo "▶ Enviando código para ${HOST}…"
rsync -az --delete -e "$SSH" \
  --filter=':- .gitignore' \
  --exclude '.git' \
  --exclude 'infra/volumes' \
  --exclude '.env.production' \
  ./ "$HOST:~/atendo/"

# A versão vai para o APP_VERSION do servidor: é o que o painel aberto compara para avisar
# "saiu versão nova, atualize". Sem isso, o atendente roda o código de ontem sem saber.
VERSION=$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)
echo "▶ Subindo a stack (versão $VERSION)…"
# shellcheck disable=SC2029
$SSH "$HOST" "cd ~/atendo \
  && (grep -q '^APP_VERSION=' .env.production || echo 'APP_VERSION=' >> .env.production) \
  && sed -i 's|^APP_VERSION=.*|APP_VERSION=$VERSION|' .env.production \
  && sudo docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build" 

echo "▶ Estado dos serviços:"
$SSH "$HOST" 'cd ~/atendo && sudo docker compose -f infra/docker-compose.prod.yml --env-file .env.production ps --format "table {{.Service}}\t{{.Status}}"'

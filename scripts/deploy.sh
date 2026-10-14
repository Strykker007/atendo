#!/bin/bash
# Envia o código para o servidor e sobe a stack de produção — e numera a versão.
#
# Uso: bash scripts/deploy.sh ubuntu@IP [correcao|recurso|grande|mesma] [caminho-da-chave]
#
# Versão (SemVer, MAIOR.MENOR.CORREÇÃO, no package.json da raiz — docs/17-entrada-em-producao.md#versões):
#   correcao  1.4.2 → 1.4.3   conserto, ajuste de texto, nada novo para o cliente aprender
#   recurso   1.4.2 → 1.5.0   coisa nova (tela, opção, integração) que não quebra o que existe
#   grande    1.4.2 → 2.0.0   muda o jeito de usar ou quebra compatibilidade (migração destrutiva, API)
#   mesma     1.4.2           redeploy sem mudança (servidor caiu, variável de ambiente nova)
# Sem o tipo, o script pergunta. Com versão nova: atualiza package.json e CHANGELOG.md (commits
# desde a última tag), commita "chore(release)", cria a tag vX.Y.Z e, com o deploy no ar, envia
# main + tag para o GitHub.
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
KIND=${2:-}
KEY=${3:-$HOME/.ssh/atendo-prod.key}
# compatível com o uso antigo (deploy.sh HOST chave): 2º argumento que é arquivo = chave
if [ -n "$KIND" ] && [ -f "$KIND" ]; then KEY=$KIND; KIND=; fi

# ---- versão ----
CUR=$(node -p "require('./package.json').version")
LAST_TAG=$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)
if [ -z "$KIND" ]; then
  [ -t 0 ] || { echo "✖ Informe o tipo de versão: correcao | recurso | grande | mesma" >&2; exit 1; }
  IFS=. read -r MA MI PA <<< "$CUR"
  echo "Versão atual: $CUR${LAST_TAG:+ (última publicada: $LAST_TAG)}"
  echo "  1) correção  → $MA.$MI.$((PA + 1))   conserto, sem nada novo para aprender"
  echo "  2) recurso   → $MA.$((MI + 1)).0   coisa nova que não quebra o que existe"
  echo "  3) grande    → $((MA + 1)).0.0   muda o jeito de usar / quebra compatibilidade"
  echo "  4) mesma     → $CUR   redeploy sem mudança"
  read -r -p "Tipo [1-4]: " OP
  case "$OP" in 1) KIND=correcao ;; 2) KIND=recurso ;; 3) KIND=grande ;; 4) KIND=mesma ;; *) echo "✖ Opção inválida." >&2; exit 1 ;; esac
fi
IFS=. read -r MA MI PA <<< "$CUR"
case "$KIND" in
  correcao|patch) NEW="$MA.$MI.$((PA + 1))" ;;
  recurso|minor)  NEW="$MA.$((MI + 1)).0" ;;
  grande|major)   NEW="$((MA + 1)).0.0" ;;
  mesma|none)     NEW="$CUR" ;;
  *) echo "✖ Tipo de versão desconhecido: '$KIND' (use correcao | recurso | grande | mesma)." >&2; exit 1 ;;
esac
if [ "$NEW" != "$CUR" ] && git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; then
  echo "✖ A tag v$NEW já existe." >&2; exit 1
fi
if [ -t 0 ]; then
  read -r -p "Publicar v$NEW${LAST_TAG:+ (antes: $LAST_TAG)}? [s/N] " OK
  [ "$OK" = "s" ] || [ "$OK" = "S" ] || { echo "Cancelado."; exit 1; }
fi

# só numera de verdade quando o deploy é da main (DEPLOY_ANY_BRANCH é emergência, não release)
RELEASE=0
if [ "${DEPLOY_ANY_BRANCH:-}" != "1" ] && ! git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; then
  RELEASE=1
  if [ "$NEW" != "$CUR" ]; then
    node -e "const f='package.json',p=require('./'+f);p.version='$NEW';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
    # entrada do CHANGELOG com os commits desde a última versão (sem merges nem releases)
    RANGE=${LAST_TAG:+$LAST_TAG..HEAD}
    NOTES=$(git log ${RANGE:-HEAD} --no-merges --pretty='- %s' | grep -v '^- chore(release)' || true)
    { echo "## $NEW — $(date +%Y-%m-%d)"; echo; echo "${NOTES:-- (sem commits novos)}"; echo; } > /tmp/atendo-changelog-entry
    if [ -f CHANGELOG.md ]; then
      awk 'NR==FNR{e=e $0 "\n"; next} /^## /&&!d{printf "%s", e; d=1} {print} END{if(!d) printf "%s", e}' /tmp/atendo-changelog-entry CHANGELOG.md > /tmp/atendo-changelog && mv /tmp/atendo-changelog CHANGELOG.md
    else
      { echo "# Changelog"; echo; cat /tmp/atendo-changelog-entry; } > CHANGELOG.md
    fi
    rm -f /tmp/atendo-changelog-entry
    git add package.json CHANGELOG.md
    git commit -q -m "chore(release): v$NEW"
  fi
  git tag -a "v$NEW" -m "v$NEW"
  echo "▶ Versão v$NEW (tag criada)"
fi

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
# "saiu versão nova, atualize" (e o que o rodapé do menu mostra). `1.4.2+abc1234`: o número e o
# commit — redeploy da mesma versão também muda o valor, e o aviso aparece.
VERSION="$NEW+$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
echo "▶ Subindo a stack (versão $VERSION)…"
# shellcheck disable=SC2029
$SSH "$HOST" "cd ~/atendo \
  && (grep -q '^APP_VERSION=' .env.production || echo 'APP_VERSION=' >> .env.production) \
  && sed -i 's|^APP_VERSION=.*|APP_VERSION=$VERSION|' .env.production \
  && sudo docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build" 

echo "▶ Estado dos serviços:"
$SSH "$HOST" 'cd ~/atendo && sudo docker compose -f infra/docker-compose.prod.yml --env-file .env.production ps --format "table {{.Service}}\t{{.Status}}"'

# com o deploy no ar, a versão vai para o GitHub (a tag é o registro do que está em produção)
# (também no redeploy "mesma": se o push da vez anterior falhou, vai agora)
if [ "${DEPLOY_ANY_BRANCH:-}" != "1" ]; then
  if git push -q origin main --follow-tags; then
    echo "▶ v$NEW enviada para o GitHub (main + tag)"
  else
    echo "⚠ Deploy feito, mas o push falhou — rode: git push origin main --follow-tags" >&2
  fi
  if [ "$NEW" != "$CUR" ]; then echo "ℹ Traga a versão para a develop: git checkout develop && git merge main"; fi
fi

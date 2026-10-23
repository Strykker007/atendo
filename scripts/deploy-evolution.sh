#!/bin/bash
# Deploy da Evolution — separado do deploy comum de propósito (docs/27-deploy-evolution.md).
# Trocar o container reconecta TODOS os números (sem QR: as credenciais ficam no banco/Redis dela).
#
# Uso: bash scripts/deploy-evolution.sh ubuntu@IP <status|build|up|rollback> [caminho-da-chave]
#   status    imagem rodando × imagem pedida pelo compose, instâncias abertas. Não muda nada.
#   build     envia infra/evolution + compose e constrói a imagem (patches + testes no build).
#             Não toca no container: os números seguem conectados.
#   up        troca o container pela imagem construída. Pede a frase de confirmação, guarda a
#             imagem atual como atendo/evolution-api:previous e faz backup do banco da Evolution e
#             do Redis antes. Não recria evolution-db nem redis.
#   rollback  volta o container para atendo/evolution-api:previous (mesma confirmação).
#
# Canário (docs/27-deploy-evolution.md#canário) — container à parte, só para as instâncias de
# EVOLUTION_CANARY_INSTANCES; nenhuma destas ações toca na Evolution principal:
#   canary-status  imagem pedida × rodando e instâncias abertas no canário.
#   canary-build   como `build`, mas constrói a imagem do canário (EVOLUTION_CANARY_IMAGE).
#   canary-up      cria o banco evolution_canary se faltar e sobe/troca o container do canário.
#   canary-stop    para o canário (os números dele ficam sem conexão até voltarem para a principal).
#
# Sem `up`/`rollback`, nada é reiniciado. Rodar fora de horário de movimento (doc 23 › 4).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/prod-compose.sh
source scripts/lib/prod-compose.sh

HOST=${1:?informe o destino, ex.: bash scripts/deploy-evolution.sh ubuntu@1.2.3.4 status}
ACTION=${2:?informe a ação: status | build | up | rollback | canary-status | canary-build | canary-up | canary-stop}
KEY=${3:-$HOME/.ssh/atendo-prod.key}
SSH="ssh -i $KEY -o BatchMode=yes"
CONFIRM_PHRASE="RECONECTAR TODOS OS NUMEROS"
MAINT='~/atendo-maint'

remote() {
  # shellcheck disable=SC2029
  $SSH "$HOST" "cd $PC_DIR && $1"
}

status() {
  echo "▶ Pedida pelo compose: $(remote "$(pc_evo_wanted_cmd)")"
  echo "▶ Rodando:             $(remote "$(pc_evo_running_cmd)")"
  echo "▶ Instâncias abertas:  $(remote "$PC_SUDO docker exec \$($(pc_compose) --profile evolution ps -q evolution | head -1) sh -c 'wget -qO- --header=\"apikey: \$AUTHENTICATION_API_KEY\" http://localhost:8080/instance/fetchInstances' | grep -o '\"connectionStatus\":\"open\"' | wc -l" || echo '?')"
}

canary_status() {
  echo "▶ Canário pedido:      $(remote "$(pc_canary_wanted_cmd)")"
  echo "▶ Canário rodando:     $(remote "$(pc_canary_running_cmd)")"
  echo "▶ Abertas no canário:  $(remote "id=\$($(pc_compose) --profile evolution-canary ps -q evolution-canary | head -1); [ -n \"\$id\" ] && $PC_SUDO docker exec \"\$id\" sh -c 'wget -qO- --header=\"apikey: \$AUTHENTICATION_API_KEY\" http://localhost:8080/instance/fetchInstances' | grep -o '\"connectionStatus\":\"open\"' | wc -l || echo 0" || echo '?')"
}

# envio do código: só da main e sem alteração pendente (DEPLOY_ANY_BRANCH=1 para emergência)
send_evolution_code() {
  if [ "${DEPLOY_ANY_BRANCH:-}" != "1" ]; then
    [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "✖ Só da main (DEPLOY_ANY_BRANCH=1 para emergência)." >&2; exit 1; }
    [ -z "$(git status --porcelain)" ] || { echo "✖ Há alterações não commitadas." >&2; exit 1; }
  fi
  echo "▶ Enviando infra/evolution e o compose…"
  rsync -az --delete -e "$SSH" infra/evolution/ "$HOST:~/atendo/infra/evolution/"
  rsync -az -e "$SSH" "$PC_FILE" "$HOST:~/atendo/$PC_FILE"
}

confirm() {
  [ -t 0 ] || { echo "✖ '$ACTION' só em terminal interativo: reconecta todos os números." >&2; exit 1; }
  echo "⚠ Isto recria o container da Evolution: TODOS os números desconectam e reconectam (sem QR)."
  read -r -p "Digite \"$CONFIRM_PHRASE\" para continuar: " ANS
  [ "$ANS" = "$CONFIRM_PHRASE" ] || { echo "Cancelado."; exit 1; }
}

backup() {
  # pg_dump do banco da Evolution + cópia do Redis (chaves Signal) no mesmo instante, antes da troca.
  # BGSAVE não bloqueia o Redis; espera o LASTSAVE mudar antes de copiar.
  local ts; ts=$(date +%Y%m%d-%H%M%S)
  echo "▶ Backup em $MAINT/evolution-$ts.*"
  remote "mkdir -p $MAINT \
    && $PC_SUDO docker exec \$($(pc_compose) ps -q evolution-db | head -1) pg_dump -U evolution -d evolution -Fc > $MAINT/evolution-$ts.dump \
    && r=\$($(pc_compose) ps -q redis | head -1) && last=\$($PC_SUDO docker exec \$r redis-cli LASTSAVE) \
    && $PC_SUDO docker exec \$r redis-cli BGSAVE >/dev/null \
    && for i in \$(seq 1 60); do [ \"\$($PC_SUDO docker exec \$r redis-cli LASTSAVE)\" != \"\$last\" ] && break; sleep 2; done \
    && [ \"\$($PC_SUDO docker exec \$r redis-cli LASTSAVE)\" != \"\$last\" ] \
    && $PC_SUDO docker cp \$r:/data/dump.rdb $MAINT/redis-$ts.rdb \
    && ls -la $MAINT/evolution-$ts.dump $MAINT/redis-$ts.rdb"
}

case "$ACTION" in
  status)
    status ;;
  build)
    send_evolution_code
    echo "▶ Construindo (os testes dos patches rodam no build; falhou = imagem não gerada)…"
    remote "$(pc_evo_build_cmd)"
    status
    echo "ℹ Container não foi trocado. Para trocar: bash scripts/deploy-evolution.sh $HOST up" ;;
  up)
    status
    WANTED=$(remote "$(pc_evo_wanted_cmd)")
    [ -n "$WANTED" ] || { echo "✖ Não achei a imagem da evolution no compose." >&2; exit 1; }
    remote "$(pc_evo_image_exists_cmd "$WANTED")" || { echo "✖ $WANTED não existe no servidor — rode 'build' antes." >&2; exit 1; }
    confirm
    backup
    remote "$(pc_evo_snapshot_cmd)"
    echo "▶ Trocando o container da Evolution por ${WANTED}…"
    remote "$(pc_evo_up_cmd)"
    sleep 30
    status
    echo "ℹ Rollback: bash scripts/deploy-evolution.sh $HOST rollback" ;;
  rollback)
    status
    remote "$(pc_evo_image_exists_cmd "$EVOLUTION_REPO:previous")" || { echo "✖ Não há $EVOLUTION_REPO:previous no servidor." >&2; exit 1; }
    confirm
    echo "▶ Voltando o container da Evolution para $EVOLUTION_REPO:previous…"
    remote "$(pc_evo_rollback_cmd)"
    sleep 30
    status
    echo "ℹ O compose continua pedindo a imagem nova: o deploy comum avisa a diferença e não mexe." ;;
  canary-status)
    canary_status ;;
  canary-build)
    send_evolution_code
    echo "▶ Construindo a imagem do canário (testes dos patches no build)…"
    remote "$(pc_canary_build_cmd)"
    canary_status
    echo "ℹ Canário não foi trocado. Para subir: bash scripts/deploy-evolution.sh $HOST canary-up" ;;
  canary-up)
    WANTED=$(remote "$(pc_canary_wanted_cmd)")
    [ -n "$WANTED" ] || { echo "✖ Não achei a imagem do evolution-canary no compose." >&2; exit 1; }
    remote "$(pc_evo_image_exists_cmd "$WANTED")" || { echo "✖ $WANTED não existe no servidor — rode 'canary-build' antes." >&2; exit 1; }
    remote "$(pc_canary_db_cmd)"
    echo "▶ Subindo o canário com ${WANTED} (a Evolution principal não é tocada)…"
    remote "$(pc_canary_up_cmd)"
    sleep 20
    canary_status ;;
  canary-stop)
    remote "$(pc_canary_stop_cmd)"
    canary_status ;;
  *)
    echo "✖ Ação desconhecida: $ACTION (status | build | up | rollback | canary-status | canary-build | canary-up | canary-stop)" >&2; exit 1 ;;
esac

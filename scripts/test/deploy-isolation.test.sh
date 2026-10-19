#!/bin/bash
# Teste do isolamento do deploy (docs/27-deploy-evolution.md). Precisa de Docker local; NÃO fala com
# servidor nenhum. Sobe um projeto compose falso com os mesmos nomes, depends_on, profile e imagem
# interpolada da produção (containers que só dormem) e roda os MESMOS comandos que
# scripts/deploy.sh e scripts/deploy-evolution.sh geram (scripts/lib/prod-compose.sh).
#
#   bash scripts/test/deploy-isolation.test.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BASE_IMAGE=${BASE_IMAGE:-redis:7-alpine}
T=$(mktemp -d)
PROJECT=atendo-deploy-test-$$
FAIL=0
cleanup() { (cd "$T" && docker compose -p "$PROJECT" -f compose.yml --env-file env --profile evolution down -v --remove-orphans >/dev/null 2>&1) || true; docker image rm -f "mock/api:1" mock/evo:1 mock/evo:2 mock/evolution-api:previous >/dev/null 2>&1 || true; docker images -q 'mock/evolution-api' | xargs -r docker image rm -f >/dev/null 2>&1 || true; rm -rf "$T"; }
trap cleanup EXIT

ok() { echo "  ✔ $1"; }
ko() { echo "  ✖ $1"; FAIL=1; }

mkdir -p "$T/app" "$T/evo"
printf 'FROM %s\nARG V=1\nRUN echo "$V" > /v\n' "$BASE_IMAGE" > "$T/app/Dockerfile"
printf 'FROM %s\nARG V=1\nRUN echo "$V" > /v\n' "$BASE_IMAGE" > "$T/evo/Dockerfile"
: > "$T/env"
compose() { # $1 = tag padrão da evolution, $2 = versão da app, $3 = comando do redis
  cat > "$T/compose.yml" <<EOF
x-app: &app
  build: { context: ./app, args: { V: "$2" } }
  image: mock/api:1
  command: ["sleep", "1000000"]
  depends_on: { postgres: { condition: service_started }, redis: { condition: service_started } }
services:
  api: { <<: *app }
  worker: { <<: *app }
  web: { image: $BASE_IMAGE, command: ["sleep", "1000000"] }
  caddy: { image: $BASE_IMAGE, command: ["sleep", "1000000"], depends_on: [api, web] }
  postgres: { image: $BASE_IMAGE, command: ["sleep", "1000000"] }
  redis: { image: $BASE_IMAGE, command: ["sleep", "$3"] }
  evolution:
    build: { context: ./evo, args: { V: "$1" } }
    profiles: ["evolution"]
    image: \${EVOLUTION_IMAGE:-mock/evo:$1}
    command: ["sleep", "1000000"]
    depends_on: { evolution-db: { condition: service_started }, redis: { condition: service_started } }
  backup: { image: $BASE_IMAGE, command: ["sleep", "1000000"], depends_on: [postgres, evolution-db] }
  evolution-db: { image: $BASE_IMAGE, command: ["sleep", "1000000"] }
EOF
}

# mesmos comandos da produção, apontados para o projeto falso
export PC_DIR="$T" PC_FILE=compose.yml PC_ENV=env PC_SUDO=""
# shellcheck source=../lib/prod-compose.sh
source "$ROOT/scripts/lib/prod-compose.sh"
EVOLUTION_REPO=mock/evolution-api
run() { (cd "$T" && COMPOSE_PROJECT_NAME=$PROJECT bash -c "$1"); }
cid() { (cd "$T" && docker compose -p "$PROJECT" -f compose.yml --env-file env --profile evolution ps -q "$1" | head -1); }
state() { for s in api worker web caddy backup postgres redis evolution-db evolution; do echo "$s $(cid "$s") $(docker inspect -f '{{.State.StartedAt}}' "$(cid "$s")" 2>/dev/null)"; done; }
same() { [ "$(grep "^$1 " "$2")" = "$(grep "^$1 " "$3")" ]; }

echo "▶ estado inicial (instalação já rodando: evolution mock/evo:1)"
compose 1 1 1000000
run "docker compose -f compose.yml --env-file env --profile evolution up -d --build" > "$T/boot.log" 2>&1 || { cat "$T/boot.log"; exit 1; }
state > "$T/s0"

echo "▶ commit novo: app muda, tag da evolution muda (1→2) e config do redis muda"
compose 2 2 999999
run "$(pc_require_running_cmd)" && ok "pré-requisito: postgres e redis rodando" || ko "pré-requisito falhou"
run "$(pc_app_up_cmd)" >/dev/null 2>&1 && ok "deploy comum executou" || ko "deploy comum falhou"
state > "$T/s1"
for s in evolution evolution-db postgres redis; do same "$s" "$T/s0" "$T/s1" && ok "deploy comum NÃO recriou/reiniciou $s" || ko "deploy comum mexeu em $s"; done
same api "$T/s0" "$T/s1" && ko "deploy comum não recriou api" || ok "deploy comum recriou api (código novo)"
[ "$(docker inspect -f '{{.Config.Image}}' "$(cid evolution)")" = "mock/evo:1" ] && ok "evolution segue na imagem antiga" || ko "imagem da evolution mudou"
DRIFT=$(run "$(pc_drift_cmd)")
echo "$DRIFT" | grep -q "evolution: .*deploy-evolution.sh" && ok "aviso de pendência da evolution" || ko "sem aviso da evolution: $DRIFT"
echo "$DRIFT" | grep -q "redis: .*procedimento manual" && ok "aviso de pendência do redis" || ko "sem aviso do redis: $DRIFT"

echo "▶ engano do operador: 'docker compose up -d' sem nome de serviço"
run "docker compose -f compose.yml --env-file env up -d" >/dev/null 2>&1 || true
state > "$T/s2"
same evolution "$T/s1" "$T/s2" && ok "profile protegeu a evolution" || ko "up -d sem serviço recriou a evolution"

echo "▶ deploy-evolution build: constrói sem trocar o container"
run "$(pc_evo_build_cmd)" >/dev/null 2>&1 && ok "build executou" || ko "build falhou"
state > "$T/s3"
same evolution "$T/s2" "$T/s3" && ok "build não tocou no container" || ko "build trocou o container"
WANTED=$(run "$(pc_evo_wanted_cmd)")
[ "$WANTED" = "mock/evo:2" ] && ok "imagem pedida = mock/evo:2" || ko "imagem pedida: $WANTED"
run "$(pc_evo_image_exists_cmd "$WANTED")" && ok "imagem construída existe" || ko "imagem não existe"
run "$(pc_evo_image_exists_cmd mock/nao-existe:9)" && ko "image_exists aceitou imagem inexistente" || ok "image_exists recusa imagem inexistente"

echo "▶ deploy-evolution up"
OLD_IMG=$(docker inspect -f '{{.Image}}' "$(cid evolution)")
run "$(pc_evo_snapshot_cmd)" >/dev/null
[ "$(docker image inspect -f '{{.Id}}' mock/evolution-api:previous)" = "$OLD_IMG" ] && ok "imagem anterior guardada como :previous" || ko ":previous errada"
run "$(pc_evo_up_cmd)" >/dev/null 2>&1 && ok "up executou" || ko "up falhou"
state > "$T/s4"
same evolution "$T/s3" "$T/s4" && ko "evolution não foi trocada" || ok "evolution trocada"
[ "$(docker inspect -f '{{.Config.Image}}' "$(cid evolution)")" = "mock/evo:2" ] && ok "evolution em mock/evo:2" || ko "imagem errada após up"
for s in evolution-db redis postgres api worker web caddy backup; do same "$s" "$T/s3" "$T/s4" && ok "up da evolution NÃO mexeu em $s" || ko "up da evolution mexeu em $s"; done

echo "▶ deploy-evolution rollback"
run "$(pc_evo_rollback_cmd)" >/dev/null 2>&1 && ok "rollback executou" || ko "rollback falhou"
state > "$T/s5"
[ "$(docker inspect -f '{{.Image}}' "$(cid evolution)")" = "$OLD_IMG" ] && ok "evolution voltou à imagem anterior" || ko "rollback não voltou a imagem"
for s in evolution-db redis postgres api; do same "$s" "$T/s4" "$T/s5" && ok "rollback NÃO mexeu em $s" || ko "rollback mexeu em $s"; done
run "$(pc_drift_cmd)" | grep -q "evolution:" && ok "deploy comum avisa que a evolution está fora do compose (rollback)" || ko "sem aviso pós-rollback"

echo "▶ pré-requisito: redis parado bloqueia o deploy comum"
docker stop "$(cid redis)" >/dev/null
run "$(pc_require_running_cmd)" 2>/dev/null && ko "deploy seguiria sem redis" || ok "deploy recusado sem redis"

[ $FAIL = 0 ] && echo "✔ todos os testes passaram" || { echo "✖ houve falhas"; exit 1; }

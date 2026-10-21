#!/bin/bash
# Laboratório de reconexão da Evolution (docs/30-testes-locais.md). Sobe uma Evolution DESCARTÁVEL
# (projeto compose próprio "atendo-evo-lab", porta 18080, banco/Redis/volumes efêmeros) — nunca o
# stack de dev (infra/docker-compose.yml, porta 8080) nem suas sessões. Nenhum número é pareado:
# as instâncias do laboratório ficam sem QR lido.
#
#   bash scripts/test/evolution-lab.sh <cenário> [segundos] [instâncias]
#     dns          web.whatsapp.com → 127.0.0.1 (conexão recusada na hora; equivale a DNS/rede fora)
#     timeout      web.whatsapp.com → 10.255.255.1 (não responde: timeout do handshake)
#     recovery     começa como "dns" e, na metade do tempo, devolve o DNS real: mede a recuperação
#     concurrency  rede normal (só gera QR, ninguém lê): 10 connects + 3 restarts simultâneos
#     compare      "dns" com a imagem antiga (v2.3.7-atendo.2) e a nova, lado a lado
#
# Cenários de rede ("dns", "timeout", "recovery", "compare") e "concurrency" (fala com o WhatsApp para
# gerar QR) só com autorização — não são executados por scripts/test/local.sh sem --lab.
set -euo pipefail
SCENARIO=${1:?cenário: dns | timeout | recovery | concurrency | compare}
SECS=${2:-120}
N=${3:-1}
NEW=${EVOLUTION_LAB_IMAGE:-atendo/evolution-api:v2.3.7-atendo.5}
OLD=${EVOLUTION_LAB_OLD_IMAGE:-atendo/evolution-api:v2.3.7-atendo.2}
P=atendo-evo-lab
OUT=${LAB_OUT:-.reports}
mkdir -p "$OUT"

cleanup() { docker rm -f $P-evo $P-db $P-redis >/dev/null 2>&1 || true; docker network rm $P >/dev/null 2>&1 || true; }
trap cleanup EXIT

up() { # $1 imagem, $2 add-host (ou vazio)
  cleanup
  docker network create $P >/dev/null
  docker run -d --rm --name $P-db --network $P -e POSTGRES_USER=evolution -e POSTGRES_PASSWORD=lab -e POSTGRES_DB=evolution postgres:16-alpine >/dev/null
  docker run -d --rm --name $P-redis --network $P redis:7-alpine >/dev/null
  for _ in $(seq 1 30); do docker exec $P-db pg_isready -U evolution >/dev/null 2>&1 && break; sleep 1; done
  docker run -d --rm --name $P-evo --network $P ${2:+--add-host "$2"} -p 18080:8080 \
    -e SERVER_URL=http://localhost:18080 -e AUTHENTICATION_API_KEY=lab -e DATABASE_ENABLED=true -e DATABASE_PROVIDER=postgresql \
    -e DATABASE_CONNECTION_URI=postgresql://evolution:lab@$P-db:5432/evolution -e CACHE_REDIS_ENABLED=true \
    -e CACHE_REDIS_URI=redis://$P-redis:6379/6 -e CACHE_LOCAL_ENABLED=false -e LOG_LEVEL=ERROR,WARN,INFO,LOG \
    -e ATENDO_STATS_MS=5000 "$1" >/dev/null
  for _ in $(seq 1 90); do curl -s localhost:18080/ 2>/dev/null | grep -q working && break; sleep 2; done
  for i in $(seq 1 "$N"); do curl -s -o /dev/null -X POST localhost:18080/instance/create -H 'apikey: lab' -H 'Content-Type: application/json' -d "{\"instanceName\":\"lab$i\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}" & done; wait
}
creds() { echo 'select count(*) || chr(58) || coalesce(md5(string_agg(creds::text, chr(44) order by "sessionId")), chr(45)) from "Session";' | docker exec -i $P-db psql -U evolution -d evolution -At; }
count() { docker logs $P-evo 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -c 'Baileys version' || true; }
guard() { docker logs $P-evo 2>&1 | grep '"atendo":"connection-guard"' || true; }
stats() { guard | grep '"evt":"process.stats"' | tail -1; }
line() { printf '%s\n' "$*" | tee -a "$OUT/evolution-lab.ndjson"; }

measure() { # $1 imagem, $2 add-host
  up "$1" "$2"; local c0; c0=$(creds); sleep "$SECS"; local c1; c1=$(creds)
  local n; n=$(count)
  line "{\"kind\":\"LABORATORIO — sem WhatsApp pareado\",\"scenario\":\"$SCENARIO\",\"image\":\"$1\",\"instances\":$N,\"seconds\":$SECS,\"connections\":$n,\"perSecond\":$(awk "BEGIN{printf \"%.2f\", $n/$SECS}"),\"credsUnchanged\":$([ "$c0" = "$c1" ] && echo true || echo false),\"lastStats\":$(stats | sed 's/^$/null/')}"
}

case "$SCENARIO" in
  dns) measure "$NEW" "web.whatsapp.com:127.0.0.1" ;;
  timeout) measure "$NEW" "web.whatsapp.com:10.255.255.1" ;;
  compare) measure "$OLD" "web.whatsapp.com:127.0.0.1"; measure "$NEW" "web.whatsapp.com:127.0.0.1" ;;
  recovery)
    up "$NEW" "web.whatsapp.com:127.0.0.1"
    sleep $((SECS / 2))
    before=$(count)
    docker exec $P-evo sh -c "grep -v web.whatsapp.com /etc/hosts > /tmp/h && cat /tmp/h > /etc/hosts"
    t0=$(date +%s)
    rec=""
    for _ in $(seq 1 $((SECS / 2))); do
      docker logs $P-evo 2>&1 | grep -q 'qrcodeCount' && { rec=$(( $(date +%s) - t0 )); break; }
      sleep 1
    done
    line "{\"kind\":\"LABORATORIO — sem WhatsApp pareado\",\"scenario\":\"recovery\",\"image\":\"$NEW\",\"connectionsWhileDown\":$before,\"recoverySeconds\":${rec:-null},\"note\":\"recuperado = WhatsApp voltou a responder (QR gerado); a espera é o degrau do backoff em que a instância estava\"}" ;;
  concurrency)
    up "$NEW" ""
    sleep 10
    b=$(guard | grep -c '"evt":"socket.created"' || true)
    for _ in $(seq 1 10); do curl -s -o /dev/null localhost:18080/instance/connect/lab1 -H 'apikey: lab' & done
    for _ in 1 2 3; do curl -s -o /dev/null -X POST localhost:18080/instance/restart/lab1 -H 'apikey: lab' & done
    wait; sleep 5
    a=$(guard | grep -c '"evt":"socket.created"' || true)
    line "{\"kind\":\"LABORATORIO — sem WhatsApp pareado\",\"scenario\":\"concurrency\",\"image\":\"$NEW\",\"socketsCreatedBy10Connects3Restarts\":$((a - b)),\"joined\":$(guard | grep -c '"evt":"connect.joined"' || true),\"stale\":$(guard | grep -c '"evt":"stale.dropped"' || true)}" ;;
  *) echo "✖ cenário desconhecido: $SCENARIO" >&2; exit 1 ;;
esac

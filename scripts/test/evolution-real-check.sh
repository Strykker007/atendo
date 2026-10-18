#!/bin/bash
# Coleta evidências do teste com WhatsApp REAL no stack de dev (docs/30-testes-locais.md › Parte 3).
# SÓ LÊ: não envia mensagem, não reinicia nada, não imprime credenciais nem chaves. Rodar depois de
# cada passo do roteiro (QR, troca de mensagens, restart, reinício do container).
#
#   bash scripts/test/evolution-real-check.sh <instanceName> [minutos=60]
set -euo pipefail
cd "$(dirname "$0")/../.."
INST=${1:?informe o instanceName do número de teste (Números → detalhes, ou /instance/fetchInstances)}
MIN=${2:-60}
DC="docker compose -f infra/docker-compose.yml --env-file .env"
KEY=$(grep -E '^EVOLUTION_API_KEY=' .env | cut -d= -f2-)
OUT=.reports; mkdir -p $OUT
F=$OUT/real-$(date +%Y%m%d-%H%M%S).md
EVO=$($DC ps -q evolution)
[ -n "$EVO" ] || { echo "✖ Evolution do stack de dev não está rodando (pnpm start:all)"; exit 1; }
{
echo "# WhatsApp REAL — $INST — $(date '+%d/%m/%Y %H:%M')"
echo
echo "## Imagem e patches"
echo "- imagem: \`$(docker inspect -f '{{.Config.Image}}' "$EVO")\`"
for m in "dist/main.js:/*atendo-connection*/:guarda de conexão" "dist/main.js:/*atendo-restart*/:restart" "dist/main.js:/*atendo-placeholder-triggers*/:gatilhos de placeholder" "node_modules/baileys/lib/Utils/process-message.js:/*atendo-cve-2026-48063*/:CVE (process-message)" "node_modules/baileys/lib/Utils/decode-wa-message.js:/*atendo-cve-2026-48063*/:CVE (decode)" "node_modules/baileys/lib/Socket/messages-send.js:atendoBizNodes:nó <biz>"; do
  IFS=: read -r file mark name <<< "$m"
  n=$(docker exec "$EVO" grep -c -F "$mark" "/evolution/$file" 2>/dev/null || echo 0)
  echo "- $name: $([ "$n" -ge 1 ] && echo '✔ presente' || echo '✖ AUSENTE — rebuild: docker compose -f infra/docker-compose.yml --env-file .env build evolution')"
done
echo
echo "## Sessão"
echo "- estado na Evolution: \`$(curl -s "localhost:8080/instance/connectionState/$INST" -H "apikey: $KEY")\`"
ID=$(echo "select id from \"Instance\" where name='$INST';" | $DC exec -T evolution-db psql -U evolution -d evolution -At)
echo "- credenciais persistidas (linha em Session, conteúdo não exibido): $(echo "select count(*) from \"Session\" where \"sessionId\"='$ID';" | $DC exec -T evolution-db psql -U evolution -d evolution -At)"
RK=$($DC exec -T redis redis-cli -n 6 --scan --pattern "evolution:*$ID*" | head -1 | tr -d '\r')
echo "- chaves Signal no Redis (só a contagem): $([ -n "$RK" ] && echo "\`$RK\` com $($DC exec -T redis redis-cli -n 6 HLEN "$RK" | tr -d '\r') campos" || echo '✖ nenhuma chave da instância encontrada')"
echo "- último fechamento definitivo registrado: \`$(echo "select coalesce(\"disconnectionReasonCode\"::text,'-') || ' em ' || coalesce(\"disconnectionAt\"::text,'-') from \"Instance\" where name='$INST';" | $DC exec -T evolution-db psql -U evolution -d evolution -At)\`"
echo
echo "## Guarda de conexão (últimos $MIN min)"
docker logs --since "${MIN}m" "$EVO" 2>&1 | grep '"atendo":"connection-guard"' | grep "\"$INST\"" > /tmp/atendo-real-guard.$$ || true
echo '```'
grep -o '"evt":"[a-z.]*"' /tmp/atendo-real-guard.$$ | sort | uniq -c || true
echo '```'
echo "- reconexões agendadas: $(grep -c reconnect.scheduled /tmp/atendo-real-guard.$$ || true); recuperações: $(grep -c reconnect.recovered /tmp/atendo-real-guard.$$ || true); estacionado (440): $(grep -c reconnect.parked /tmp/atendo-real-guard.$$ || true); eventos de socket antigo descartados: $(grep -c stale.dropped /tmp/atendo-real-guard.$$ || true)"
grep reconnect.recovered /tmp/atendo-real-guard.$$ | tail -3 | sed 's/^/    /' || true
rm -f /tmp/atendo-real-guard.$$
echo "- CVE: protocolMessage forjado descartado (esperado 0 em uso normal): $(docker logs --since "${MIN}m" "$EVO" 2>&1 | grep -c 'dropping spoofed' || true)"
echo "- mensagens descartadas por erro de decifragem (esperado 0): $(docker logs --since "${MIN}m" "$EVO" 2>&1 | grep -c 'Message ignored with messageStubParameters' || true)"
echo
echo "## Atendo (banco local)"
NUM=$(echo "select id from whatsapp_numbers where \"externalId\"='$INST' and \"deletedAt\" is null limit 1;" | $DC exec -T postgres psql -U atendo -d atendo -At)
echo "- número: \`$NUM\` — status: $(echo "select status from whatsapp_numbers where id='$NUM';" | $DC exec -T postgres psql -U atendo -d atendo -At)"
echo '- mensagens nos últimos '"$MIN"' min (direção / status / quantidade):'
echo '```'
echo "select direction, status, count(*) from messages where \"numberId\"='$NUM' and \"queuedAt\" > now() - interval '$MIN minutes' group by 1,2 order by 1,2;" | $DC exec -T postgres psql -U atendo -d atendo
echo '```'
echo "- últimos connection.update recebidos pelo Atendo:"
echo '```'
$DC exec -T redis redis-cli LRANGE "wa:conn:log:$NUM" 0 9 | cut -c1-220
echo '```'
} | tee "$F"
echo; echo "relatório: $F"

#!/bin/bash
# Sobe o Atendo inteiro no Mac: Docker (Colima) + infra + API + web.
# Uso: pnpm start:all          (ou: bash scripts/up.sh)
set -e
cd "$(dirname "$0")/.."

echo "▶ Docker (Colima)…"
colima status >/dev/null 2>&1 || colima start --cpu 2 --memory 4

echo "▶ Infra (Postgres, Redis, Evolution)…"
docker compose -f infra/docker-compose.yml --env-file .env up -d >/dev/null
for i in $(seq 1 30); do docker compose -f infra/docker-compose.yml --env-file .env ps postgres 2>/dev/null | grep -q healthy && break; sleep 1; done

echo "▶ Migrations…"
pnpm --filter @atendo/api prisma migrate deploy >/dev/null 2>&1 || true

# Derruba resquícios de execuções anteriores. Matar só quem escuta a porta não basta: o
# processo do watcher (nest/next) sobrevive e vários deles brigam pelo mesmo dist/.next,
# produzindo erros de compilação que não existem no código.
pkill -f "nest.js start" 2>/dev/null || true
pkill -f "next-server|next dev" 2>/dev/null || true
for p in 4000 3000; do lsof -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | xargs -I{} kill -9 {} 2>/dev/null || true; done
sleep 2

echo "▶ API (:4000) e web (:3000)…"
mkdir -p .logs
(cd apps/api && nohup pnpm dev > ../../.logs/api.log 2>&1 < /dev/null &)
(cd apps/web && nohup pnpm dev > ../../.logs/web.log 2>&1 < /dev/null &)

for i in $(seq 1 60); do curl -s -m 1 localhost:4000/health >/dev/null 2>&1 && break; sleep 1; done
for i in $(seq 1 60); do curl -s -m 1 -o /dev/null localhost:3000/login 2>/dev/null && break; sleep 1; done

echo
echo "✅ Atendo no ar"
echo "   Painel:    http://localhost:3000   (demo@atendo.local / demo12345)"
echo "   API:       http://localhost:4000/health"
echo "   Evolution: http://localhost:8080"
echo "   Logs:      .logs/api.log  .logs/web.log     Parar: pnpm stop:all"

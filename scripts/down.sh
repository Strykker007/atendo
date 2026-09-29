#!/bin/bash
# Para API, web e infra (Docker). Os dados ficam salvos nos volumes.
cd "$(dirname "$0")/.."
# o watcher (nest/next) não escuta porta: matar só quem escuta deixa zumbis para trás
pkill -f "nest.js start" 2>/dev/null; pkill -f "next-server|next dev" 2>/dev/null
for p in 4000 3000; do lsof -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | xargs -I{} kill -9 {} 2>/dev/null || true; done
docker compose -f infra/docker-compose.yml --env-file .env stop >/dev/null
echo "⏹ Atendo parado (dados preservados). Para desligar o Docker também: colima stop"

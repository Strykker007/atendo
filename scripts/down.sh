#!/bin/bash
# Para API, web e infra (Docker). Os dados ficam salvos nos volumes.
cd "$(dirname "$0")/.."
pkill -f "nest start --watch" 2>/dev/null; pkill -f "next dev -p 3000" 2>/dev/null
for p in 4000 3000; do lsof -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | xargs -I{} kill {} 2>/dev/null || true; done
docker compose -f infra/docker-compose.yml --env-file .env stop >/dev/null
echo "⏹ Atendo parado (dados preservados). Para desligar o Docker também: colima stop"

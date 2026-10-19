#!/bin/bash
# Testes locais da estabilização da Evolution (docs/30-testes-locais.md). Usa só o stack de dev
# desta máquina; recusa rodar se o .env apontar para fora de localhost.
#
#   pnpm test:local                 # mocks da guarda + testes da API + carga sintética 100/500/1000
#   pnpm test:local -- --quick      # carga só com 100
#   pnpm test:local -- --lab        # + laboratório de reconexão (Evolution descartável; ver autorização no doc)
#
# Relatório consolidado em .reports/local-<data>.md (simulado × laboratório × WhatsApp real separados).
set -uo pipefail
cd "$(dirname "$0")/../.."
QUICK=0; LAB=0
for a in "$@"; do case "$a" in --quick) QUICK=1 ;; --lab) LAB=1 ;; esac; done
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p .reports
export LAB_OUT=.reports/lab-$STAMP
mkdir -p "$LAB_OUT"
RESULTS=.reports/local-$STAMP.results
: > "$RESULTS"
step() { echo; echo "━━ $1"; }
record() { echo "$1|$2|$3" >> "$RESULTS"; }

# ---- trava: só ambiente local ----
[ -f .env ] || { echo "✖ sem .env na raiz"; exit 2; }
for v in DATABASE_URL REDIS_URL EVOLUTION_BASE_URL; do
  host=$(grep -E "^$v=" .env | cut -d= -f2- | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#')
  case "$host" in localhost|127.0.0.1|::1) ;; *) echo "✖ $v aponta para '$host' — não é local. Nada foi executado."; exit 2 ;; esac
done
grep -qE '^NODE_ENV=production' .env && { echo "✖ NODE_ENV=production no .env"; exit 2; }

step "1/4 Guarda de conexão — mocks (408, 428, 440, 515, DNS, concorrência, tempestade)"
if node --test infra/evolution/test/connection-guard.test.mjs > .reports/guard-$STAMP.tap 2>&1; then
  record guard ok "$(grep -E '^# pass' .reports/guard-$STAMP.tap | awk '{print $3}') testes"
else record guard falhou "ver .reports/guard-$STAMP.tap"; fi
grep -E '^(not ok|# (pass|fail))' .reports/guard-$STAMP.tap

step "2/4 API — ordem do connection.update, prazos, códigos, sonda (+ Lua no Redis local)"
REDIS=$(grep -E '^REDIS_URL=' .env | cut -d= -f2-)
if (cd apps/api && REDIS_TEST_URL="$REDIS" npx vitest run test/connection-stability.test.ts test/evolution.provider.test.ts > ../../.reports/api-$STAMP.log 2>&1); then
  record api ok "$(grep -E 'Tests ' .reports/api-$STAMP.log | sed 's/\x1b\[[0-9;]*m//g' | xargs)"
else record api falhou "ver .reports/api-$STAMP.log"; fi
grep -E 'Tests |FAIL' .reports/api-$STAMP.log | sed 's/\x1b\[[0-9;]*m//g'

step "3/4 Carga sintética no fluxo interno (sem WhatsApp)"
if curl -s -m 2 localhost:4000/health >/dev/null; then
  grep -qE '^DIAG_STATS_MS=[1-9]' .env || echo "ℹ sem DIAG_STATS_MS no .env: memória/event loop da API não serão medidos (DIAG_STATS_MS=1000 e reinicie a API)"
  SIZES="100 500 1000"; [ $QUICK = 1 ] && SIZES=100
  for n in $SIZES; do
    if (cd apps/api && pnpm loadtest -- --messages "$n" | tee ../../.reports/load-$n-$STAMP.log); then record "carga $n" ok "$(grep -o 'loadtest-[a-z0-9]*.json' .reports/load-$n-$STAMP.log | tail -1)"
    else record "carga $n" falhou "$(grep -o 'loadtest-[a-z0-9]*.json' .reports/load-$n-$STAMP.log | tail -1)"; fi
  done
else
  record carga pulado "API local fora do ar (pnpm start:all)"; echo "⚠ API local fora do ar — carga pulada"
fi

step "4/4 Laboratório de reconexão (Evolution descartável)"
if [ $LAB = 1 ]; then
  for sc in "compare 120 10" "timeout 120 1" "recovery 240 1" "concurrency 30 1"; do
    # shellcheck disable=SC2086
    bash scripts/test/evolution-lab.sh $sc && record "lab ${sc%% *}" ok "" || record "lab ${sc%% *}" falhou ""
  done
else
  record lab pulado "rode com --lab depois de autorizado"; echo "pulado (use --lab)"
fi

node scripts/test/local-report.mjs "$STAMP" > .reports/local-$STAMP.md
echo; echo "▶ Relatório: .reports/local-$STAMP.md"
! grep -q '|falhou|' "$RESULTS"

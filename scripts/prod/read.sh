#!/usr/bin/env bash
# Consulta em produção com o papel SÓ DE LEITURA `atendo_ro` (scripts/prod/readonly-role.sql).
# É o único jeito de olhar o banco de produção para diagnóstico — inclusive pelo Claude.
#
# Uso:  bash scripts/prod/read.sh "select count(*) from messages where status = 'pending'"
#       bash scripts/prod/read.sh < consulta.sql
set -euo pipefail
KEY=${PROD_KEY:-$HOME/.ssh/atendo-prod.key}
HOST=${PROD_HOST:-ubuntu@163.176.200.252}
SQL=${1:-$(cat)}
[ -n "$SQL" ] || { echo "informe a consulta (argumento ou stdin)" >&2; exit 1; }
# a consulta vai pelo stdin: nada de aspas atravessando ssh → docker → psql
ssh -i "$KEY" -o BatchMode=yes "$HOST" \
  'docker exec -i atendo-prod-postgres-1 psql -v ON_ERROR_STOP=1 -U atendo_ro -d atendo -P pager=off' <<< "$SQL"

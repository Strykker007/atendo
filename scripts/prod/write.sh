#!/usr/bin/env bash
# Alteração MANUAL no banco de produção — só quando não houver jeito pelo sistema
# (docs/33-operacao-segura-producao.md). Nunca colar UPDATE/DELETE direto no psql.
#
# Uso:
#   bash scripts/prod/write.sh arquivo.sql                         # simulação: roda e DESFAZ
#   bash scripts/prod/write.sh arquivo.sql --apply --expect 18 --motivo "mensagens presas de 26/10"
#
# O arquivo tem UM comando UPDATE/DELETE/INSERT, terminado em `;`. O script:
#   - recusa UPDATE/DELETE sem WHERE;
#   - roda dentro de uma transação e conta as linhas afetadas;
#   - simulação (padrão): mostra a contagem e desfaz;
#   - --apply: só confirma se a contagem for EXATAMENTE o --expect; senão desfaz;
#   - registra a operação aplicada em docs/operacoes-producao.md (data, motivo, linhas, SQL).
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY=${PROD_KEY:-$HOME/.ssh/atendo-prod.key}
HOST=${PROD_HOST:-ubuntu@163.176.200.252}

FILE=${1:?informe o arquivo .sql}
shift
APPLY=0; EXPECT=; MOTIVO=
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --expect) EXPECT=${2:?--expect precisa de um número}; shift ;;
    --motivo) MOTIVO=${2:?--motivo precisa de texto}; shift ;;
    *) echo "opção desconhecida: $1" >&2; exit 1 ;;
  esac
  shift
done

SQL=$(sed -e 's/--.*$//' "$FILE" | tr '\n' ' ' | sed -e 's/[[:space:]]\{1,\}/ /g' -e 's/^ //' -e 's/ *;* *$//')
[ -n "$SQL" ] || { echo "✖ arquivo vazio" >&2; exit 1; }
case "$SQL" in *";"*) echo "✖ um comando só por arquivo" >&2; exit 1 ;; esac
VERBO=$(echo "$SQL" | awk '{print toupper($1)}')
case "$VERBO" in
  UPDATE|DELETE) echo "$SQL" | grep -qi ' where ' || { echo "✖ $VERBO sem WHERE recusado" >&2; exit 1; } ;;
  INSERT) ;;
  *) echo "✖ só UPDATE, DELETE ou INSERT (consulta: scripts/prod/read.sh)" >&2; exit 1 ;;
esac
if [ "$APPLY" = 1 ]; then
  [[ "$EXPECT" =~ ^[0-9]+$ ]] || { echo "✖ --apply exige --expect N (quantas linhas devem mudar)" >&2; exit 1; }
  [ -n "$MOTIVO" ] || { echo "✖ --apply exige --motivo \"…\"" >&2; exit 1; }
fi

# RETURNING 1 + count: a contagem sai da própria transação. Confirma só se bater com o esperado.
FIM="ROLLBACK"
# (cada meta-comando do psql na própria linha: `\if` não aceita nada depois da expressão)
[ "$APPLY" = 1 ] && FIM=$(printf '%s\n' '\if :ok' 'COMMIT;' "\\echo '✔ confirmado'" '\else' 'ROLLBACK;' "\\echo '✖ contagem diferente do esperado: DESFEITO'" '\endif')
SCRIPT=$(cat <<EOF
\\set ON_ERROR_STOP 1
BEGIN;
WITH alterou AS ($SQL RETURNING 1) SELECT count(*) AS linhas, (count(*) = ${EXPECT:--1}) AS ok FROM alterou \\gset
\\echo 'linhas afetadas: ' :linhas
$FIM
EOF
)
[ "$APPLY" = 1 ] || echo "▶ SIMULAÇÃO (nada é gravado; para gravar: --apply --expect N --motivo \"…\")"
# WRITE_LOCAL=1: roda no Postgres do docker local (teste do próprio script), nunca em produção
if [ "${WRITE_LOCAL:-}" = 1 ]; then
  OUT=$(docker exec -i atendo-postgres-1 sh -c 'psql -X -q -U $POSTGRES_USER -d $POSTGRES_DB' <<< "$SCRIPT")
else
  OUT=$(ssh -i "$KEY" -o BatchMode=yes "$HOST" \
    'docker exec -i atendo-prod-postgres-1 sh -c "psql -X -q -U \$POSTGRES_USER -d \$POSTGRES_DB"' <<< "$SCRIPT")
fi
echo "$OUT"

if [ "$APPLY" = 1 ] && [ "${WRITE_LOCAL:-}" != 1 ] && echo "$OUT" | grep -q '✔ confirmado'; then
  LOG=docs/operacoes-producao.md
  {
    echo ""
    echo "## $(date '+%Y-%m-%d %H:%M') — $MOTIVO"
    echo ""
    echo "- quem: $(git config user.name 2>/dev/null || whoami) · linhas: $EXPECT · arquivo: \`$FILE\`"
    echo ""
    echo '```sql'
    cat "$FILE"
    echo '```'
  } >> "$LOG"
  echo "▶ registrado em $LOG — commite junto com a correção que evita repetir"
fi

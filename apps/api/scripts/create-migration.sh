#!/bin/sh
# Cria uma migration sem o modo interativo do `prisma migrate dev` (útil em CI e em agentes).
# Uso: sh scripts/create-migration.sh nome_da_migration
set -e
NAME=${1:?informe o nome da migration}
DIR=prisma/migrations/$(date -u +%Y%m%d%H%M%S)_$NAME
SHADOW=${SHADOW_DATABASE_URL:-postgresql://atendo:atendo@localhost:5433/atendo_shadow}
mkdir -p "$DIR"
pnpm prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW" --script 2>/dev/null | grep -v '^warn\|^For more\|^\$ prisma' > "$DIR/migration.sql"
echo "→ $DIR/migration.sql"; cat "$DIR/migration.sql"
pnpm prisma migrate deploy && pnpm prisma generate

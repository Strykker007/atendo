#!/bin/sh
# Restauração do Atendo. Uso: sh restore.sh <pasta-do-backup>
#
# DESTRUTIVO: sobrescreve os bancos atuais. Pare a API e o worker antes.
set -eu
SRC=${1:?informe a pasta do backup, ex.: /backup/20260929-030000}
[ -f "$SRC/atendo.dump" ] || { echo "não encontrei $SRC/atendo.dump"; exit 1; }

echo "Restaurando de $SRC — os dados atuais serão substituídos."
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h postgres -U "$POSTGRES_USER" -d atendo --clean --if-exists "$SRC/atendo.dump"
echo "banco principal restaurado"

if [ -f "$SRC/evolution.dump" ]; then
  PGPASSWORD="$EVOLUTION_DB_PASSWORD" pg_restore -h evolution-db -U evolution -d evolution --clean --if-exists "$SRC/evolution.dump"
  echo "banco da Evolution restaurado"
fi

if [ -f "$SRC/evolution-instances.tar.gz" ]; then
  tar xzf "$SRC/evolution-instances.tar.gz" -C /data/evolution
  echo "sessões da Evolution restauradas — reinicie o container evolution"
fi

if [ -f "$SRC/storage.tar.gz" ]; then
  tar xzf "$SRC/storage.tar.gz" -C /data/storage
  echo "mídia restaurada"
fi

echo "Pronto. Suba api e worker de novo."

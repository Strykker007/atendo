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
elif [ -n "${BACKUP_REMOTE:-}" ]; then
  # com remoto a mídia não fica na pasta datada: está em $BACKUP_REMOTE/storage (backup.sh)
  echo "mídia: está em $BACKUP_REMOTE/storage — restaure com (o volume do serviço é só leitura):"
  echo "  docker compose -f infra/docker-compose.prod.yml --env-file .env.production run --rm -v ./volumes/storage:/restore backup rclone copy $BACKUP_REMOTE/storage /restore"
fi

echo "Pronto. Suba api e worker de novo."

#!/bin/sh
# Backup do Atendo: bancos + sessões da Evolution, com envio para storage remoto.
#
# Roda dentro do container `backup` (ver docker-compose.prod.yml), uma vez por dia.
# Perder isto significa perder conversas, agendamentos e o pareamento de TODOS os números.
set -eu

STAMP=$(date -u +%Y%m%d-%H%M%S)
DIR=/backup/$STAMP
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
mkdir -p "$DIR"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

log "dump do banco principal"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h postgres -U "$POSTGRES_USER" -d atendo -Fc -f "$DIR/atendo.dump"

log "dump do banco da Evolution"
PGPASSWORD="$EVOLUTION_DB_PASSWORD" pg_dump -h evolution-db -U evolution -d evolution -Fc -f "$DIR/evolution.dump"

# As credenciais de pareamento vivem aqui: sem elas, todo número precisa ler o QR de novo.
log "sessões da Evolution"
tar czf "$DIR/evolution-instances.tar.gz" -C /data/evolution . 2>/dev/null || log "AVISO: volume da Evolution vazio ou inacessível"

# Mídia só entra no backup quando o storage é local; com S3/R2 a durabilidade é do provedor.
if [ -d /data/storage ] && [ "$(ls -A /data/storage 2>/dev/null)" ]; then
  log "mídia (storage local)"
  tar czf "$DIR/storage.tar.gz" -C /data/storage .
fi

echo "$STAMP" > "$DIR/MANIFEST"
du -sh "$DIR" | log

# Envio remoto. Backup que só existe no mesmo servidor não protege contra perder o servidor.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  log "enviando para $BACKUP_REMOTE"
  rclone --config /config/rclone.conf copy "$DIR" "$BACKUP_REMOTE/$STAMP" --transfers 4
  rclone --config /config/rclone.conf delete "$BACKUP_REMOTE" --min-age "${KEEP_DAYS}d" --rmdirs || true
else
  log "AVISO: BACKUP_REMOTE não configurado — backup só no servidor, sem proteção contra perda da máquina"
fi

log "limpando cópias locais com mais de $KEEP_DAYS dias"
find /backup -maxdepth 1 -type d -name '20*' -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true

log "concluído: $DIR"

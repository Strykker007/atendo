#!/bin/sh
# Backup do Atendo: bancos + sessões da Evolution, com envio para storage remoto.
#
# Roda dentro do container `backup` (ver docker-compose.prod.yml), uma vez por dia.
# Perder isto significa perder conversas, agendamentos e o pareamento de TODOS os números.
set -eu

STAMP=$(date -u +%Y%m%d-%H%M%S)
DIR=/backup/$STAMP
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
# A cópia no servidor precisa caber no disco; no R2 podemos manter mais pontos
# de recuperação. Sem a variável nova, preserva o comportamento anterior.
REMOTE_KEEP_DAYS=${BACKUP_REMOTE_KEEP_DAYS:-$KEEP_DAYS}
mkdir -p "$DIR"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

# Falhou no meio (ex.: disco cheio em 24/10/2026): a pasta incompleta não serve para restaurar e
# só ocupa espaço — com o disco cheio, Redis e bancos param de gravar.
trap '[ -f "$DIR/MANIFEST" ] || { rm -rf "$DIR"; log "backup incompleto removido: $DIR"; }' EXIT

log "dump do banco principal"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h postgres -U "$POSTGRES_USER" -d atendo -Fc -f "$DIR/atendo.dump"

log "dump do banco da Evolution"
PGPASSWORD="$EVOLUTION_DB_PASSWORD" pg_dump -h evolution-db -U evolution -d evolution -Fc -f "$DIR/evolution.dump"

# As credenciais de pareamento vivem aqui: sem elas, todo número precisa ler o QR de novo.
log "sessões da Evolution"
tar czf "$DIR/evolution-instances.tar.gz" -C /data/evolution . 2>/dev/null || log "AVISO: volume da Evolution vazio ou inacessível"

# Mídia só entra no backup quando o storage é local; com S3/R2 a durabilidade é do provedor.
# Com remoto, vai incremental para $BACKUP_REMOTE/storage (só arquivos novos, nunca apaga lá):
# o tar diário era uma cópia inteira (~17 GB em out/2026) e chegou a encher o disco.
HAS_MEDIA=
if [ -d /data/storage ] && [ "$(ls -A /data/storage 2>/dev/null)" ]; then HAS_MEDIA=1; fi
if [ -n "$HAS_MEDIA" ] && [ -z "${BACKUP_REMOTE:-}" ]; then
  log "mídia (storage local, sem remoto: tar)"
  tar czf "$DIR/storage.tar.gz" -C /data/storage .
fi

echo "$STAMP" > "$DIR/MANIFEST"
# o tamanho é o sinal mais rápido de backup vazio — log() lê argumentos, não stdin
log "tamanho: $(du -sh "$DIR" | cut -f1)"

# Envio remoto. Backup que só existe no mesmo servidor não protege contra perder o servidor.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  log "enviando para $BACKUP_REMOTE"
  rclone copy "$DIR" "$BACKUP_REMOTE/$STAMP" --transfers 4
  if [ -n "$HAS_MEDIA" ]; then
    log "mídia (incremental) para $BACKUP_REMOTE/storage"
    rclone copy /data/storage "$BACKUP_REMOTE/storage" --transfers 4
  fi
  # a retenção vale para as pastas datadas; a mídia é uma cópia só, que só cresce
  rclone delete "$BACKUP_REMOTE" --min-age "${REMOTE_KEEP_DAYS}d" --exclude "/storage/**" --rmdirs || true
else
  log "AVISO: BACKUP_REMOTE não configurado — backup só no servidor, sem proteção contra perda da máquina"
fi

# KEEP_DAYS=0 = só a cópia de hoje fica no servidor. `-mtime +0` só pega pastas com mais de
# 24 h, então a de ontem sobrevivia e o servidor guardava duas.
if [ "$KEEP_DAYS" -eq 0 ]; then
  log "limpando cópias locais anteriores"
  find /backup -mindepth 1 -maxdepth 1 -type d -name '20*' ! -path "$DIR" -exec rm -rf {} + 2>/dev/null || true
else
  log "limpando cópias locais com mais de $KEEP_DAYS dias"
  find /backup -mindepth 1 -maxdepth 1 -type d -name '20*' ! -path "$DIR" -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
fi

log "concluído: $DIR"

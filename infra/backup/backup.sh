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
# Aviso que não derruba o backup (ex.: mídia não terminou) mas precisa chegar a alguém: o
# agenda.sh lê este arquivo e manda o alerta (docs/11-infra-producao.md#backup)
WARN_FILE=/tmp/backup-avisos
: > "$WARN_FILE"
warn() { log "AVISO: $*"; echo "$*" >> "$WARN_FILE"; }

# Dump ilegível descoberto só na hora de restaurar = não havia backup. `pg_restore --list` lê o
# índice do arquivo inteiro: arquivo truncado ou corrompido falha aqui
verify_dump() {
  pg_restore --list "$1" > /dev/null || { log "ERRO: $1 não é um dump válido"; exit 1; }
  log "conferido: $(basename "$1") ($(du -h "$1" | cut -f1))"
}

# Falhou no meio (ex.: disco cheio em 24/10/2026): a pasta incompleta não serve para restaurar e
# só ocupa espaço — com o disco cheio, Redis e bancos param de gravar.
trap '[ -f "$DIR/MANIFEST" ] || { rm -rf "$DIR"; log "backup incompleto removido: $DIR"; }' EXIT

log "dump do banco principal"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h postgres -U "$POSTGRES_USER" -d atendo -Fc -f "$DIR/atendo.dump"
verify_dump "$DIR/atendo.dump"

log "dump do banco da Evolution"
PGPASSWORD="$EVOLUTION_DB_PASSWORD" pg_dump -h evolution-db -U evolution -d evolution -Fc -f "$DIR/evolution.dump"
verify_dump "$DIR/evolution.dump"

# As credenciais de pareamento vivem aqui: sem elas, todo número precisa ler o QR de novo.
log "sessões da Evolution"
tar czf "$DIR/evolution-instances.tar.gz" -C /data/evolution . 2>/dev/null || warn "volume da Evolution vazio ou inacessível"

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
  # confere que chegou tudo, com o mesmo tamanho (os dumps passam de 1 GB e sobem em partes, então
  # o R2 não tem MD5 deles para comparar — tamanho é o que dá para garantir). Falhou = sai com erro
  # ANTES da retenção: nada antigo é apagado se o de hoje não está lá
  rclone check "$DIR" "$BACKUP_REMOTE/$STAMP" --size-only --one-way || { log "ERRO: cópia no remoto não confere"; exit 1; }
  log "remoto conferido"
  # Mídia: comparar tudo com o R2 todo dia levava horas (o rclone faz um HEAD por objeto para ler
  # a data) e podia invadir o backup do dia seguinte. Três ritmos:
  # - dia a dia: só o que mudou nas últimas 48 h, sem listar o destino;
  # - domingo: conferência por tamanho dos últimos 62 dias (pega o que o incremental perder);
  # - 1º domingo do mês: conferência de TUDO (658 mil arquivos em nov/2026; parou nas 6 h em 01/11).
  # Sem --fast-list: ele monta a lista inteira do bucket na memória antes de começar; pasta por
  # pasta (cliente/mês) a memória fica pequena e o progresso não se perde se cortar no meio.
  # Falha aqui não impede a retenção nem o "concluído" (os bancos já subiram), mas vira alerta.
  if [ -n "$HAS_MEDIA" ]; then
    if [ "$(date +%u)" = "${BACKUP_MEDIA_FULL_DOW:-7}" ]; then
      if [ "$(date +%d)" -le 7 ]; then
        log "mídia (conferência completa do mês) para $BACKUP_REMOTE/storage"
        rclone copy /data/storage "$BACKUP_REMOTE/storage" --transfers 8 --checkers 16 --size-only --max-duration "${BACKUP_MEDIA_FULL_HOURS:-10}h" \
          || warn "conferência completa da mídia não terminou — ver docs/11-infra-producao.md#backup"
      else
        log "mídia (conferência dos últimos 62 dias) para $BACKUP_REMOTE/storage"
        rclone copy /data/storage "$BACKUP_REMOTE/storage" --transfers 8 --checkers 16 --size-only --max-age 62d --max-duration 6h \
          || warn "conferência semanal da mídia não terminou"
      fi
    else
      log "mídia (últimas 48 h) para $BACKUP_REMOTE/storage"
      rclone copy /data/storage "$BACKUP_REMOTE/storage" --transfers 8 --max-age 48h --no-traverse \
        || warn "falha ao enviar a mídia recente"
    fi
    log "mídia enviada"
  fi
  # a retenção vale para as pastas datadas; a mídia é uma cópia só, que só cresce
  rclone delete "$BACKUP_REMOTE" --min-age "${REMOTE_KEEP_DAYS}d" --exclude "/storage/**" --rmdirs || true
else
  warn "BACKUP_REMOTE não configurado — backup só no servidor, sem proteção contra perda da máquina"
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

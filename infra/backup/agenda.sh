#!/bin/sh
# Roda o backup todo dia no horário BACKUP_AT (HH:MM, fuso do container — America/Sao_Paulo).
# Antes era "a cada 24 h desde que o container subiu", o que caía no meio do expediente: o
# pg_dump do banco da Evolution (GBs) pesa nos bancos, que não têm o teto de CPU deste container.
set -u

# Alerta (docs/11-infra-producao.md#backup): BACKUP_PING_URL é um "dead man's switch" (ex.:
# healthchecks.io). Sucesso = ping na URL; falha ou aviso = ping em <URL>/fail com o fim do log.
# Se o backup nem rodar (container parado, servidor fora), o serviço avisa sozinho por falta de ping.
avisar() {
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  case "$1" in
    ok) url="$BACKUP_PING_URL" ;;
    *) url="$BACKUP_PING_URL/fail" ;;
  esac
  tail -c 10000 /tmp/backup.log | curl -fsS -m 20 --retry 3 --data-binary @- "$url" > /dev/null \
    || echo "[agenda] AVISO: não consegui avisar $1 em BACKUP_PING_URL"
}
ALVO=${BACKUP_AT:-03:30}
H=$(expr "${ALVO%:*}" + 0)
M=$(expr "${ALVO#*:}" + 0)
while true; do
  agora=$(( $(expr "$(date +%H)" + 0) * 3600 + $(expr "$(date +%M)" + 0) * 60 + $(expr "$(date +%S)" + 0) ))
  alvo=$(( H * 3600 + M * 60 ))
  espera=$(( alvo - agora ))
  [ "$espera" -le 0 ] && espera=$(( espera + 86400 ))
  echo "[agenda] próximo backup às $ALVO (em $(( espera / 60 )) min)"
  sleep "$espera"
  # saída num arquivo para mandar o fim do log junto do alerta; depois vai para o docker logs
  sh /usr/local/bin/backup.sh > /tmp/backup.log 2>&1
  rc=$?
  cat /tmp/backup.log
  if [ "$rc" -ne 0 ]; then
    echo 'BACKUP FALHOU'
    status=falhou
  elif [ -s /tmp/backup-avisos ]; then
    status=aviso
  else
    status=ok
  fi
  # último resultado no volume: dá para conferir no servidor sem ler o log
  echo "$(date '+%d/%m/%Y %H:%M') $status" > /backup/ULTIMO_STATUS 2>/dev/null || true
  avisar "$status"
  # garante que não roda duas vezes no mesmo minuto
  sleep 60
done

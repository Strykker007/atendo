#!/bin/sh
# Roda o backup todo dia no horário BACKUP_AT (HH:MM, fuso do container — America/Sao_Paulo).
# Antes era "a cada 24 h desde que o container subiu", o que caía no meio do expediente: o
# pg_dump do banco da Evolution (GBs) pesa nos bancos, que não têm o teto de CPU deste container.
set -u
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
  sh /usr/local/bin/backup.sh || echo 'BACKUP FALHOU'
  # garante que não roda duas vezes no mesmo minuto
  sleep 60
done

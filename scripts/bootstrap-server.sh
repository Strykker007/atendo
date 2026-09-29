#!/bin/bash
# Prepara um servidor Ubuntu limpo (inclusive Oracle Cloud ARM) para rodar o Atendo.
#
# Uso, já no servidor:
#   curl -fsSL https://raw.githubusercontent.com/SEU_USUARIO/atendo/main/scripts/bootstrap-server.sh | bash
#   ou: bash scripts/bootstrap-server.sh
#
# Instala Docker, abre as portas e deixa o repositório pronto. Não sobe nada.
set -euo pipefail

log() { echo; echo "▶ $*"; }

# Este script mexe em iptables, swap e timedatectl: só faz sentido no servidor Linux.
# Rodá-lo no Mac de desenvolvimento não quebra nada, mas pede sudo à toa e confunde.
if [ "$(uname -s)" != "Linux" ]; then
  cat <<'TXT'
✋ Este script é para o SERVIDOR (Ubuntu/Linux), não para a sua máquina.

   Conecte no servidor primeiro:
     ssh ubuntu@IP_DA_INSTANCIA

   E rode lá dentro:
     bash scripts/bootstrap-server.sh

   Para subir o Atendo AQUI no seu Mac, use:  pnpm start:all
TXT
  exit 1
fi

if [ ! -r /etc/os-release ] || ! grep -qiE 'ubuntu|debian' /etc/os-release; then
  echo "⚠  Distribuição não reconhecida — o script assume Ubuntu/Debian (apt)."
  echo "   Siga por conta própria ou instale Docker manualmente."
fi

log "Docker"
if command -v docker >/dev/null 2>&1; then
  echo "  já instalado: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo "  instalado — saia e entre de novo na sessão para usar docker sem sudo"
fi

log "Portas 80 e 443"
# A imagem Ubuntu da Oracle vem com iptables restritivo POR DENTRO da máquina. Abrir só a
# security list da VCN no painel não basta: o tráfego chega e é descartado aqui. É o motivo
# nº 1 de "apontei o DNS e o site não abre" na Oracle.
if command -v iptables >/dev/null 2>&1; then
  for p in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null \
      || sudo iptables -I INPUT 6 -p tcp --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then
    sudo netfilter-persistent save >/dev/null 2>&1 || true
  else
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null 2>&1 || true
  fi
  echo "  liberadas no iptables (e salvas)"
fi
echo "  LEMBRE: abra 80 e 443 também na security list da VCN, no painel da Oracle."

log "Swap (a Evolution usa ~100 MB por número; swap evita OOM em pico)"
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "  4 GB de swap criados"
else
  echo "  já existe"
fi

log "Fuso horário"
sudo timedatectl set-timezone America/Sao_Paulo 2>/dev/null || true
echo "  $(date '+%d/%m/%Y %H:%M %Z')"

cat <<TXT

✅ Servidor pronto. Próximos passos:

   git clone SEU_REPOSITORIO atendo && cd atendo
   bash scripts/prepare-prod.sh seudominio.com.br
   # preencha as chaves de terceiros em .env.production
   docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
   docker compose -f infra/docker-compose.prod.yml --env-file .env.production exec api npx prisma db seed

   Antes de subir, confirme que o DNS já resolve para este servidor:
   dig +short app.seudominio.com.br
TXT

# Comandos de docker compose da produção, usados por scripts/deploy.sh e scripts/deploy-evolution.sh.
# Só MONTAM o texto dos comandos (rodados no servidor via ssh); os testes rodam os mesmos textos num
# projeto compose falso (scripts/test/deploy-isolation.test.sh). Ver docs/27-deploy-evolution.md.
#
# Regra: o deploy comum mexe só na aplicação. Evolution, o banco dela, o Postgres e o Redis guardam
# estado (sessões do WhatsApp, chaves Signal, filas) — recriar qualquer um é decisão explícita.

# Variáveis só para teste local; em produção ficam os padrões.
PC_DIR=${PC_DIR:-'~/atendo'}
PC_FILE=${PC_FILE:-infra/docker-compose.prod.yml}
PC_ENV=${PC_ENV:-.env.production}
PC_SUDO=${PC_SUDO-sudo}

# serviços que o deploy comum recria (sem estado próprio)
APP_SERVICES="api worker web site caddy backup"
# nunca recriados pelo deploy comum
PROTECTED_SERVICES="postgres redis evolution-db evolution"
# serviços que precisam estar de pé antes de um deploy comum (com --no-deps ninguém os sobe)
REQUIRED_RUNNING="postgres redis"
EVOLUTION_REPO=atendo/evolution-api

pc_dc() { echo "docker compose -f $PC_FILE --env-file $PC_ENV"; }
pc_compose() { echo "$PC_SUDO $(pc_dc)"; }

# Falha se Postgres/Redis não estiverem rodando: o deploy comum não os cria (instalação nova:
# docs/27-deploy-evolution.md › Primeira subida).
pc_require_running_cmd() {
  local c; c=$(pc_compose)
  echo "running=\$($c ps --status running --services 2>/dev/null); for s in $REQUIRED_RUNNING; do echo \"\$running\" | grep -qx \"\$s\" || { echo \"✖ \$s não está rodando — o deploy comum não sobe serviços com estado (docs/27)\" >&2; exit 1; }; done"
}

# Deploy comum: constrói e recria só a aplicação. --no-deps: nada além da lista é criado,
# recriado ou reiniciado por depends_on.
pc_app_up_cmd() { echo "$(pc_compose) up -d --build --no-deps $APP_SERVICES"; }

# Caddyfile é montado como ARQUIVO: o rsync troca o arquivo (inode novo) e o container continua
# vendo o antigo — e o `up -d` não recria o caddy quando o compose não mudou. Em 26/10/2026 os
# headers de segurança do painel não entraram no deploy por isso. Compara o que o container lê
# com o do repositório e, se diferente, recria só o caddy (segundos; as conexões reconectam).
pc_caddy_sync_cmd() {
  local c; c=$(pc_compose)
  echo "id=\$($c ps -q caddy | head -1); if [ -n \"\$id\" ] && ! $PC_SUDO docker exec \"\$id\" cat /etc/caddy/Caddyfile | cmp -s - infra/Caddyfile; then echo '▶ Caddyfile mudou: recriando o caddy'; $c up -d --no-deps --force-recreate caddy; fi"
}

# Aviso (não falha): serviço protegido cuja configuração no compose mudou e só será aplicada com o
# procedimento dele. Compara o hash da configuração com o do container em execução.
pc_drift_cmd() {
  local c; c=$(pc_compose)
  echo "for s in $PROTECTED_SERVICES; do want=\$($c --profile evolution config --hash \"\$s\" 2>/dev/null | awk '{print \$2}'); id=\$($c --profile evolution ps -q \"\$s\" 2>/dev/null | head -1); [ -n \"\$want\" ] && [ -n \"\$id\" ] || continue; have=\$($PC_SUDO docker inspect -f '{{index .Config.Labels \"com.docker.compose.config-hash\"}}' \"\$id\"); [ \"\$have\" = \"\$want\" ] || echo \"⚠ \$s: configuração no compose difere da que está rodando — NÃO aplicada por este deploy (\$( [ \"\$s\" = evolution ] && echo 'scripts/deploy-evolution.sh' || echo 'procedimento manual, docs/27'))\"; done; true"
}

# ---- Evolution ----

# imagem que o compose pede (com EVOLUTION_IMAGE do .env.production/ambiente, se houver)
# (`config --images <serviço>` ignora o serviço e lista todas: lê o bloco da evolution no YAML canônico)
pc_evo_wanted_cmd() { echo "$(pc_compose) --profile evolution config evolution 2>/dev/null | awk '/^[^ ]/{f=0} /^  [^ ]/{f=0} /^  evolution:\$/{f=1; next} f && /^    image:/{print \$2; exit}'"; }
# imagem (id) do container rodando
pc_evo_running_cmd() { echo "id=\$($(pc_compose) --profile evolution ps -q evolution | head -1); [ -n \"\$id\" ] && $PC_SUDO docker inspect -f '{{.Config.Image}} {{.Image}}' \"\$id\" || echo 'nenhum container da evolution'"; }
# só constrói (os patches e verify-patches.test.mjs rodam no build); não toca no container
pc_evo_build_cmd() { echo "$(pc_compose) --profile evolution build evolution"; }
# guarda a imagem em execução como :previous e :before-<data> (rollback). Com o image store do
# containerd, sobrescrever a tag apaga a imagem antiga mesmo com o container rodando nela: aí vale
# a tag que o container pediu (reconstruída do mesmo código; docs/27-deploy-evolution.md)
pc_evo_snapshot_cmd() {
  echo "id=\$($(pc_compose) --profile evolution ps -q evolution | head -1); if [ -n \"\$id\" ]; then img=\$($PC_SUDO docker inspect -f '{{.Image}}' \"\$id\"); if ! $PC_SUDO docker image inspect \"\$img\" >/dev/null 2>&1; then img=\$($PC_SUDO docker inspect -f '{{.Config.Image}}' \"\$id\"); echo \"⚠ a imagem do container não existe mais: guardando a tag que ele pediu (\$img)\"; fi; $PC_SUDO docker tag \"\$img\" $EVOLUTION_REPO:previous && $PC_SUDO docker tag \"\$img\" $EVOLUTION_REPO:before-\$(date +%Y%m%d-%H%M%S) && echo \"▶ imagem atual guardada como $EVOLUTION_REPO:previous (\$img)\"; fi"
}
# troca só o container da Evolution: sem build (já feito), sem tocar no banco dela nem no Redis
pc_evo_up_cmd() { echo "$(pc_compose) --profile evolution up -d --no-deps --no-build evolution"; }
pc_evo_rollback_cmd() { echo "$PC_SUDO env EVOLUTION_IMAGE=$EVOLUTION_REPO:previous $(pc_dc) --profile evolution up -d --no-deps --no-build --force-recreate evolution"; }
# a imagem pedida precisa existir no host (senão o compose tentaria baixar do Docker Hub)
pc_evo_image_exists_cmd() { echo "$PC_SUDO docker image inspect \"$1\" >/dev/null 2>&1"; }

# ---- Evolution canário (docs/27-deploy-evolution.md#canário) ----
# Outro container, banco e Redis: build/up/stop dele nunca tocam na Evolution principal.
pc_canary_build_cmd() { echo "$(pc_compose) --profile evolution-canary build evolution-canary"; }
pc_canary_wanted_cmd() { echo "$(pc_compose) --profile evolution-canary config evolution-canary 2>/dev/null | awk '/^[^ ]/{f=0} /^  [^ ]/{f=0} /^  evolution-canary:\$/{f=1; next} f && /^    image:/{print \$2; exit}'"; }
pc_canary_running_cmd() { echo "id=\$($(pc_compose) --profile evolution-canary ps -q evolution-canary | head -1); [ -n \"\$id\" ] && $PC_SUDO docker inspect -f '{{.Config.Image}} {{.Image}}' \"\$id\" || echo 'canário parado'"; }
# banco próprio no mesmo Postgres da Evolution (a Evolution cria as tabelas ao subir); idempotente
pc_canary_db_cmd() {
  echo "db=\$($(pc_compose) ps -q evolution-db | head -1); $PC_SUDO docker exec \"\$db\" createdb -U evolution evolution_canary 2>/dev/null; $PC_SUDO docker exec \"\$db\" psql -U evolution -d evolution_canary -tAc 'select 1' >/dev/null && echo '▶ banco evolution_canary pronto'"
}
pc_canary_up_cmd() { echo "$(pc_compose) --profile evolution-canary up -d --no-deps --no-build evolution-canary"; }
pc_canary_stop_cmd() { echo "$(pc_compose) --profile evolution-canary stop evolution-canary"; }

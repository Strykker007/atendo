# 27 — Deploy isolado da Evolution

Recriar o container da Evolution derruba e reconecta **todos** os números de uma vez (~42 hoje).
Até 18/10/2026 o `scripts/deploy.sh` rodava `docker compose up -d --build` na stack inteira: qualquer
deploy do painel que mudasse algo da Evolution (tag da imagem, variável, patch) reconectava todo
mundo no horário do deploy. Agora são dois procedimentos separados.

## Deploy comum — `scripts/deploy.sh` (sem mudança de uso)

Sobe **só a aplicação**: `api worker web caddy backup` (`APP_SERVICES` em
`scripts/lib/prod-compose.sh`), com `--build --no-deps`.

| Serviço | No deploy comum |
|---|---|
| api, worker, web, caddy, backup | construídos/recriados como antes |
| **evolution** | nunca construída nem recriada |
| **evolution-db, postgres, redis** | nunca recriados (guardam sessões, chaves Signal e filas) |

- `--no-deps`: nenhum `depends_on` cria ou reinicia serviço fora da lista.
- Antes, confere que `postgres` e `redis` estão rodando (com `--no-deps` ninguém os subiria) e para
  se não estiverem.
- Depois, **avisa** (não aplica) qualquer serviço protegido cuja configuração no compose mudou:
  `⚠ evolution: configuração no compose difere da que está rodando — NÃO aplicada por este deploy`.
  Compara o hash de configuração do compose com o do container.

Mudança no Postgres, no Redis ou no `evolution-db` (imagem, `command`, variáveis) é **procedimento
manual e planejado**, um serviço por vez, com backup — o aviso acima lembra que há algo pendente.

## Deploy da Evolution — `scripts/deploy-evolution.sh`

```sh
bash scripts/deploy-evolution.sh ubuntu@IP status     # rodando × pedida pelo compose, instâncias abertas
bash scripts/deploy-evolution.sh ubuntu@IP build      # constrói a imagem; NÃO troca o container
bash scripts/deploy-evolution.sh ubuntu@IP up         # troca o container (madrugada)
bash scripts/deploy-evolution.sh ubuntu@IP rollback   # volta para a imagem anterior
```

- **`build`** (da `main`, sem alterações pendentes): envia `infra/evolution/` e o compose, roda
  `docker compose --profile evolution build evolution`. Os patches e os testes
  (`verify-patches.test.mjs`) rodam no build; se falharem, a imagem não é gerada e o container
  atual segue intocado.
- **`up`**: só em terminal interativo e só depois de digitar `RECONECTAR TODOS OS NUMEROS`. Em ordem:
  1. confere que a imagem pedida existe no servidor;
  2. backup: `pg_dump` do `evolution-db` + `BGSAVE` do Redis, copiados para
     `~/atendo-maint/evolution-<data>.dump` e `redis-<data>.rdb`;
  3. guarda a imagem em execução como `atendo/evolution-api:previous` e `:before-<data>`;
  4. `up -d --no-deps --no-build evolution` — não recria `evolution-db` nem `redis`;
  5. mostra o estado e as instâncias abertas 30 s depois.
- **`rollback`**: mesma confirmação; `EVOLUTION_IMAGE=atendo/evolution-api:previous … up -d --no-deps
  --no-build --force-recreate evolution`. As credenciais e as chaves são as mesmas: não pede QR. O
  compose continua pedindo a imagem nova, e o deploy comum avisa a diferença sem mexer.

### Proteções no compose de produção

- `profiles: ["evolution"]` no serviço `evolution`: um `docker compose up -d` digitado à mão, sem nome
  de serviço, **ignora** a Evolution. Os comandos que precisam dela levam `--profile evolution`.
- `image: ${EVOLUTION_IMAGE:-atendo/evolution-api:v2.3.7-atendo.3}`: o padrão é a imagem do repositório;
  a variável só existe para o rollback.
- Compose de desenvolvimento (`infra/docker-compose.yml`) **não mudou**: `pnpm infra:up` sobe tudo.

### Primeira subida (instalação nova)

`docker compose -f infra/docker-compose.prod.yml --env-file .env.production --profile evolution up -d --build`
(doc 11) — é a única vez em que tudo sobe junto.

## Risco que sobra

`docker compose up -d` sem nome de serviço ainda **recriaria Postgres/Redis/evolution-db** se a
configuração deles tivesse mudado (só a Evolution está no profile). Em produção, usar só os
scripts. Colocar esses três também em profile exigiria `depends_on` opcional, e não se sabe a
versão do Compose do servidor — fica para depois de conferi-la (`docker compose version`).

## Testes

`bash scripts/test/deploy-isolation.test.sh` (precisa de Docker local; não fala com servidor) sobe um
projeto compose falso, com os mesmos nomes, `depends_on`, profile e imagem interpolada da produção, e
roda **os mesmos comandos** que os scripts geram. 37 verificações, entre elas:

- deploy comum com app, tag da Evolution e config do Redis mudadas → recria `api` e **não** recria
  nem reinicia `evolution`, `evolution-db`, `postgres` e `redis` (id e horário de início iguais), com
  aviso para `evolution` e `redis`;
- `docker compose up -d` sem serviço → Evolution intacta (profile);
- `build` → imagem nova, container intacto;
- `up` → só a Evolution trocada, `:previous` = imagem anterior;
- `rollback` → volta à imagem anterior sem tocar em mais nada, e o deploy comum avisa a diferença;
- Redis parado → deploy comum recusado.

Resultado em 18/10/2026: **todos passaram**. O teste pegou um defeito real antes do uso:
`docker compose config --images evolution` ignora o nome do serviço e devolve a primeira imagem do
projeto. A imagem pedida agora sai do bloco `evolution` do `config` em YAML.

## Rollback desta mudança

Os scripts não alteram nada no servidor além do que fazem ao rodar. Para voltar ao comportamento
antigo: `git revert` do commit (o deploy volta a ser `up -d --build` da stack inteira) — **não
recomendado**.

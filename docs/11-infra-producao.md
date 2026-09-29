# 11 — Infra de produção e escala

## Por que "está lento" em desenvolvimento

O modo dev (`pnpm dev`) compila cada tela do Next na primeira visita e recompila a API a cada mudança. **Não é a velocidade real.** Medido com o build de produção no mesmo Mac:

| | Dev (primeira visita) | Produção |
|---|---|---|
| Página (login, conversas, relatórios) | 2–8 s | **3–30 ms** |
| API (lista, contadores, números, tags) | — | **5–20 ms** |
| `/reports/overview` (13 consultas) | — | ~190 ms |

Para sentir a velocidade real localmente: `pnpm build && pnpm --filter @atendo/web start` (e `pnpm --filter @atendo/api start`).

## Arquitetura de produção

```
                       ┌──────────── Caddy / LB (HTTPS) ────────────┐
                       │                                             │
   app.dominio ───────▶│  web (Next standalone)  ×N                  │
   api.dominio ───────▶│  api (NestJS)           ×N  ◀── Socket.IO  │
                       └────────────────┬────────────────────────────┘
                                        │
              ┌────────────┬────────────┼──────────────┬───────────────┐
              ▼            ▼            ▼              ▼               ▼
         Postgres       Redis      worker ×N     Evolution shards   S3 / R2
        (gerenciado)  (gerenciado) (filas,       evolution-1..k     (mídia)
        + PgBouncer   pub/sub +     fluxos,      (~100 MB RAM por
                      contadores    reconciliação) número conectado)
```

Peças que já estão no código para isso funcionar em cluster:
- **Socket.IO com adapter Redis** (`common/socket-io.adapter.ts`): evento emitido numa réplica chega aos sockets das outras.
- **`trust proxy`** para IP real atrás do LB; cookies `secure` em produção.
- **`GET /health`** (banco + Redis) para o LB e para o `HEALTHCHECK` do Docker.
- **Worker separado** (`node dist/src/worker`): filas de envio/recepção/fluxos/cobrança escalam independente da API.
- **Shards da Evolution**: cada número guarda opcionalmente `baseUrl`/`apiKey` do servidor Evolution que o hospeda (`EvolutionNumberConfig`). Sem isso, usa o do `.env`.
- **Migrations no start** da API (`prisma migrate deploy`), idempotente.

## Dimensionamento para 500 clientes ativos

Premissas: 500 clientes × ~2 números = ~1.000 números; ~40% via Meta (custo zero de infra) e ~60% via Evolution (~600 instâncias Baileys); ~50 mensagens/número/dia = ~50k msgs/dia (~1/s média, picos de 10–20/s). O Atendo em si é leve — o peso está na **Evolution**.

| Componente | Tamanho sugerido | Observação |
|---|---|---|
| api | 2–3 réplicas × 1 vCPU / 1 GB | I/O-bound; 1 réplica aguenta centenas de req/s |
| worker | 2 réplicas × 1 vCPU / 1 GB | envio/fluxos; aumente se a fila `wa-outbound` acumular |
| web | 1–2 réplicas × 0,5 vCPU / 512 MB | estático + SSR leve |
| Postgres | gerenciado, 2 vCPU / 8 GB, PgBouncer (transaction mode) | `connection_limit` na `DATABASE_URL` = (max conexões ÷ réplicas api+worker) |
| Redis | gerenciado, 1 GB | filas + contadores + pub/sub |
| **Evolution** | **1 servidor de 8 vCPU / 32 GB a cada ~150–200 números** | Baileys ~100–150 MB por instância; 600 números ≈ 3–4 shards. Cada shard tem seu próprio Postgres pequeno |
| S3/R2 | ilimitado | R2 sem custo de saída |

Custo aproximado na Hetzner/Contabo (VPS) para 500 clientes: R$ 1.500–2.500/mês; em AWS gerenciado, 3–4× isso. Com 500 clientes a R$ 247, a infra é < 2% da receita.

## Migração gradual (o que você pediu)

1. **Fase A — 1 host** (`infra/docker-compose.prod.yml`): Caddy + api×2 + worker×2 + web + Postgres + Redis + 1 Evolution. Até ~50–80 clientes. Backup diário do Postgres (`pg_dump`) e dos volumes da Evolution.
2. **Fase B — separar estado**: mover Postgres e Redis para gerenciados (Neon/Supabase/RDS, Upstash/ElastiCache); mídia para R2. Nada muda no código, só `.env`.
3. **Fase C — shards Evolution**: subir `evolution-2`, `evolution-3`… em hosts próprios; números novos são criados com `baseUrl` do shard menos carregado (hoje: definido na criação do número pela API; automação de balanceamento no roadmap).
4. **Fase D — orquestração** (opcional, > 200 clientes): Kubernetes ou Docker Swarm para réplicas automáticas; mesmo Dockerfile.

## Subindo a Fase A

```bash
cp .env.production.example .env.production   # preencha tudo (segredos com openssl rand)
# domínios no infra/Caddyfile
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f infra/docker-compose.prod.yml --env-file .env.production exec api node -e "require('child_process').execSync('npx tsx prisma/seed.ts',{stdio:'inherit'})"  # seed inicial (planos, dono)
```

Depois: `pnpm stripe:sync` com as chaves de produção; webhook do Stripe em `https://api.dominio/webhooks/stripe`; webhook da Meta em `https://api.dominio/webhooks/meta`.

## Boas práticas já embutidas

- Imagens multi-stage, usuário não-root, `tini`, healthcheck.
- `NEXT_PUBLIC_*` entram no **build** do web (args do Dockerfile) — mudar o domínio da API exige rebuild do web.
- CI (`.github/workflows/ci.yml`): typecheck + build + imagens a cada push em `main`.
- Variáveis validadas na subida (`config/env.ts`): falta de segredo derruba o processo cedo, com mensagem clara.

## O que ainda falta para "dormir tranquilo"

- **Backups automatizados e testados** (Postgres + volume da Evolution). É o maior buraco
  antes de um cliente pagante — ver [17](17-entrada-em-producao.md).
- Alerta ativo de número caído e de fila acumulada (o health job corrige o status, mas
  ninguém é avisado) e métricas das filas.
- Balanceamento automático de shards da Evolution.
- Testes de integração ponta a ponta (os atuais são unitários e offline).

Já resolvidos: observabilidade com log estruturado, `requestId` e Sentry opcional
([14](14-qualidade-e-observabilidade.md)); testes unitários nos adapters, no motor de fluxos
e na cobrança.

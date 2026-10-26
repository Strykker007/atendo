# 32 — Checklist de segurança

Auditoria de 26/10/2026, versão em produção **1.8.1**. Conferido no código (`apps/api`,
`apps/web`, `infra/`) e no servidor de produção, só leitura: portas, headers, segredos (só se
estão preenchidos, nunca o valor) e `pnpm audit`. Refazer a cada trimestre ou antes de uma
mudança grande (Meta oficial, gateway de pagamento).

Legenda: ✅ ok · ⚠️ ok com ressalva · ❌ falta

| # | Item | Situação | Resumo |
|---|---|---|---|
| 1 | Esconder API keys | ✅ | Segredos só no `.env.production` (permissão 600); front só expõe URLs e marca |
| 2 | Limpar secrets do git | ✅ | `.env*` ignorado; nenhum segredo no histórico inteiro |
| 3 | Só chave mínima no banco | ⚠️ | Banco fechado para fora, mas a aplicação conecta como **superusuário** |
| 4 | RLS | ⚠️ | Não usa RLS do Postgres; isolamento por `tenantId` no código |
| 5 | Criptografia de dados | ⚠️ | AES-256-GCM e TLS 1.3 ok; backup sem criptografia própria; chave sem cópia fora do servidor |
| 6 | Auth no servidor | ⚠️ | Toda rota protegida; **`META_APP_SECRET` vazio** deixa o webhook da Meta sem assinatura |
| 7 | Restringir acessos | ⚠️ | Perfis e escopos ok; servidor sem firewall próprio e root por chave liberado |
| 8 | Bloquear mass assignment | ✅ | `ValidationPipe` com `whitelist` + `forbidNonWhitelisted` |
| 9 | Proteger cookies | ✅ | Refresh `httpOnly`, `secure`, `sameSite=lax`, `path=/auth`; access token só em memória |
| 10 | Hash nas senhas | ✅ | argon2; tokens de convite/reset só como hash, uso único |
| 11 | Rate limit | ⚠️ | Global + rotas sensíveis; contador em memória por instância |
| 12 | Proteção contra bots | ❌ | Sem captcha em login, "esqueci a senha" e página pública do orçamento |
| 13 | Queries parametrizadas | ✅ | Nenhum `$queryRawUnsafe`/`$executeRawUnsafe`; tudo `Prisma.sql` |
| 14 | Validação de inputs | ⚠️ | DTOs/zod em tudo; limite de corpo de 30 MB vale para a API inteira |
| 15 | Evitar vazamento de conteúdo | ⚠️ | Erro 500 genérico; painel anuncia `x-powered-by: Next.js`; Sentry desligado |
| 16 | Restringir uploads | ✅ | Tamanho e tipo limitados, `nosniff`, comprovante por URL assinada |
| 17 | Limitar respostas da API | ✅ | Paginação com teto, `select` explícito, nada de `passwordHash` em resposta |
| 18 | Security headers | ⚠️ | API completa (helmet); **painel sem nenhum** (HSTS, CSP, X-Frame-Options) |
| 19 | Forçar HTTPS | ✅ | Caddy + Let's Encrypt, HTTP→HTTPS 308, TLS 1.3, TLS ≤ 1.1 recusado |
| 20 | Scan de dependências | ❌ | **1 crítica, 12 altas**; nenhum scan automático |

## Prioridades

| Prioridade | O quê | Item |
|---|---|---|
| 🔴 agora | Atualizar `next` para ≥ 15.5.28 (crítica: execução remota de código no otimizador de imagens) e `multer`, `body-parser`, `sharp`, `zod` | 20 |
| 🔴 agora | Headers de segurança no painel (HSTS, X-Frame-Options/`frame-ancestors`, `nosniff`, Referrer-Policy) e tirar `x-powered-by` | 18, 19, 15 |
| 🔴 antes da Meta | Preencher `META_APP_SECRET` com o App Secret do app novo ([31](31-migracao-meta-oficial.md)) | 6 |
| 🟡 semana | Cópia do `ENCRYPTION_KEY` (e demais segredos) num cofre fora do servidor | 5 |
| 🟡 semana | Contador do rate limit no Redis (vale para as duas APIs e sobrevive a deploy) | 11 |
| 🟡 semana | `PermitRootLogin no` no SSH e reiniciar o servidor (há atualização pendente de reboot) | 7 |
| 🟡 semana | Dependabot + `pnpm audit --prod --audit-level=high` no CI | 20 |
| 🟢 mês | Usuário do banco sem superusuário para a aplicação | 3 |
| 🟢 mês | Captcha (Cloudflare Turnstile) no "esqueci a senha" e após falhas de login | 12 |
| 🟢 mês | Limite de 30 MB só nos webhooks; resto da API com limite pequeno | 14 |
| 🟢 mês | Firewall no host (ufw: 22, 80, 443) além da lista de segurança da Oracle | 7 |
| 🟢 avaliar | Backup criptografado no envio (rclone `crypt`) | 5 |
| 🟢 avaliar | Guarda de `tenantId` centralizada (extensão do Prisma) ou RLS | 4 |

## Detalhe por item

### 1. Esconder API keys — ✅
- Segredos (`JWT_*`, `ENCRYPTION_KEY`, `EVOLUTION_API_KEY`, `BREVO_API_KEY`, `AI_API_KEY`…) só no
  `.env.production` do servidor, permissão `-rw-------`. O deploy não envia nem sobrescreve o arquivo.
- O front só tem `NEXT_PUBLIC_API_URL`, `_APP_URL`, `_WS_URL`, `_SITE_URL` e `_BRAND_ID` — nada secreto.
- Credenciais dos provedores (token da Meta, chave do Asaas de cada empresa) ficam no banco
  criptografadas (`CryptoService.encryptJson`, regra do projeto).
- Em 26/10 a chave do Brevo apareceu num log de sessão de trabalho e foi trocada no mesmo dia.

### 2. Limpar secrets do git — ✅
- `.gitignore` cobre `.env` e `.env.*` (só `.env.example` versionado).
- Busca no histórico inteiro (todas as branches) por padrões de chave — Brevo, Stripe, Resend, AWS,
  Anthropic, Asaas, Meta, chave privada: nenhuma ocorrência real (só um placeholder `$aact_…`).
- Sugestão: `gitleaks` no CI para barrar antes do commit chegar ao GitHub.

### 3. Só chave mínima no banco — ⚠️
- "Chave pública" é conceito de Supabase (anon key no navegador). Aqui o navegador **nunca** fala
  com o banco: só a API. Postgres (5432), Redis (6379) e Evolution (8080) não respondem de fora
  (testado da internet).
- Ressalva: a API conecta como `atendo`, que é **superusuário** (`rolsuper = t`). Se alguém
  conseguir executar SQL pela aplicação, pode tudo no servidor de banco. Criar um papel só com
  `SELECT/INSERT/UPDATE/DELETE` no schema e deixar o superusuário para migração.

### 4. RLS — ⚠️
- Não há Row Level Security no Postgres. O isolamento entre clientes é no código: toda consulta
  filtra pelo `tenantId` do usuário logado, nunca do corpo/query (regra do `CLAUDE.md`).
- Amostra das buscas por `id` sem `tenantId` na mesma linha: todas precedidas de uma checagem com
  `tenantId` (ex.: `departments`, `secure-media`, `tenants`) ou restritas ao dono do sistema.
- Risco que sobra: uma rota nova que esqueça o filtro. Defesa extra possível: extensão do Prisma
  que exige `tenantId` nos modelos do cliente, ou RLS com `SET app.tenant_id` por transação
  (projeto maior; avaliar).

### 5. Criptografia de dados — ⚠️
- Em trânsito: TLS 1.3 (Caddy), HSTS na API.
- Em repouso, campo a campo: AES-256-GCM (`common/crypto/crypto.service.ts`) para credenciais
  de provedor e segredo do 2FA (`totpSecret`).
- Ressalvas:
  - o backup vai ao R2 sem criptografia própria (o R2 criptografa em repouso, mas quem tiver a
    chave do bucket lê os dumps);
  - o `ENCRYPTION_KEY` só existe no servidor e **não vai no backup**: perder o servidor sem uma
    cópia da chave = credenciais criptografadas ilegíveis. Guardar `.env.production` num cofre.

### 6. Auth no servidor — ⚠️
- Todos os controllers usam `JwtAuthGuard`, menos `health` e os webhooks, que se autenticam:
  Meta (HMAC `x-hub-signature-256` com `timingSafeEqual`), Evolution (token da instância,
  comparação em tempo constante), Stripe (`constructEvent`), Asaas (header `asaas-access-token`).
- ❗ `META_APP_SECRET` está **vazio** em produção, e nesse caso `MetaProvider.verifyWebhook` aceita
  sem assinatura (comportamento de dev). Hoje não há número Meta (todos os 69 são Evolution), mas
  é obrigatório preencher antes de ligar a Meta oficial.
- `STRIPE_WEBHOOK_SECRET` vazio e `ASAAS_WEBHOOK_TOKEN` ausente: sem gateway configurado hoje.
  O do Asaas recusa tudo sem o token (503); preencher os dois ao ativar o gateway.

### 7. Restringir acessos — ⚠️
- Aplicação: `PermissionsGuard` + `@RequirePermission` por rota, perfis de acesso, escopo por
  número/empresa, rotas de dono separadas ([18](18-perfis-de-acesso.md)).
- Servidor: SSH só por chave (`passwordauthentication no`). Portas abertas para fora: 22, 80, 443
  (a 111/rpcbind escuta no host, mas está fechada pela lista de segurança da Oracle — testado).
- Ressalvas: `PermitRootLogin without-password` (root entra com chave) — trocar para `no`; sem
  firewall no próprio host (`ufw` inativo), toda a proteção de rede depende da Oracle; há
  atualização do sistema esperando reboot (`/var/run/reboot-required`).

### 8. Bloquear mass assignment — ✅
`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` global: campo
fora do DTO é recusado (400). Onde o corpo vai direto para o `update` (`tags`, `quick-replies`,
`scheduling`), o DTO não tem `tenantId`, `id` nem campo sensível. Rotas com `zod` usam `.parse`
com esquema fechado.

### 9. Proteger cookies — ✅
Só o refresh token é cookie (`atendo_rt`): `httpOnly`, `secure` em produção, `sameSite: lax`,
`path: /auth`. O access token fica em memória no front (não em `localStorage`), o que tira o
alvo de um XSS persistente.

### 10. Hash nas senhas — ✅
argon2 (`auth.service.ts`). Tokens de convite e de redefinição: 32 bytes aleatórios, só o hash
(sha256) no banco, uso único, expiram ([12](12-contas-e-email.md)).

### 11. Rate limit — ⚠️
Global de 120 req/min por IP (`ThrottlerGuard` em `APP_GUARD`) e limites menores: login 10/min,
"esqueci a senha" 5/min, página pública do orçamento 30/min, envio de comprovante 5/min. `trust
proxy` ligado (IP real atrás do Caddy).
Ressalva: o contador é **em memória**, por instância — com duas APIs o limite efetivo dobra, e o
deploy zera. Usar o Redis como armazenamento do throttler.

### 12. Proteção contra bots — ❌
Só o rate limit. Sem captcha no login, no "esqueci a senha" (que dispara e-mail — custo e
reputação do domínio) e na página pública do orçamento (que aceita upload). Sugestão: Cloudflare
Turnstile no "esqueci a senha" sempre e no login depois de algumas falhas.

### 13. Queries parametrizadas — ✅
Nenhum `$queryRawUnsafe`/`$executeRawUnsafe` no código; SQL manual sempre com `Prisma.sql` e
`Prisma.join` (regra do projeto, ver `reports.module.ts`).

### 14. Validação de inputs — ⚠️
DTOs com `class-validator` e esquemas `zod` nos relatórios. Ressalva: o corpo JSON aceita até
**30 MB em qualquer rota** (`main.ts`), por causa da mídia em base64 nos webhooks da Evolution.
Deixar o limite grande só em `/webhooks/*` e o resto em ~1 MB reduz a superfície de DoS.

### 15. Evitar vazamento de conteúdo — ⚠️
- Erro 500 responde "Erro interno. Tente novamente." + `requestId`, sem stack
  (`all-exceptions.filter.ts`); 404 não revela nada além da rota.
- Ressalvas: o painel envia `x-powered-by: Next.js` (`poweredByHeader: false` resolve); o Sentry
  está desligado (`SENTRY_DSN` vazio), então erro só aparece no log do container; logs do worker
  trazem identificadores de contato (`@lid`) — aceitável, mas não exportar logs para terceiros.

### 16. Restringir uploads — ✅
- `/media`: tamanho (`MEDIA_MAX_MB`) e lista fechada de tipos (imagem, áudio, vídeo, PDF, Office).
- Comprovante do orçamento (público): 1 arquivo, tamanho máximo, só JPG/PNG/WEBP/PDF, servido
  por URL assinada.
- `nosniff` na API impede que um arquivo com tipo trocado seja interpretado como HTML.
- Ressalva menor: o tipo vem do cabeçalho do envio, sem conferir os bytes do arquivo.

### 17. Limitar respostas da API — ✅
Paginação com teto (`pageSize` ≤ 100, listas com `take` fixo), e a listagem de conversas ignora
`take` vindo do cliente (o DTO não aceita). Respostas usam `select` explícito; `passwordHash`,
`totpSecret` e tokens nunca saem.

### 18. Security headers — ⚠️
- API: helmet completo — HSTS (1 ano, subdomínios), CSP, `X-Frame-Options: SAMEORIGIN`,
  `nosniff`, `Referrer-Policy: no-referrer`, COOP.
- ❗ **Painel (`app.`) sem nenhum header de segurança**: o painel pode ser aberto dentro de um
  iframe de outro site (clickjacking) e não tem HSTS. Correção: bloco `header` no Caddyfile para
  `{$APP_DOMAIN}` ou `headers()` no `next.config.ts`.

### 19. Forçar HTTPS — ✅
Caddy com Let's Encrypt automático; `http://` → `https://` com 308; TLS 1.3; TLS 1.1 ou menor
recusado. HSTS falta só no painel (item 18).

### 20. Scan de dependências — ❌
`pnpm audit --prod` em 26/10/2026: **1 crítica, 12 altas, 5 moderadas, 1 baixa**.

| Pacote | Gravidade | Problema | Corrige em |
|---|---|---|---|
| `next` 15.5.25 (painel) | crítica | execução remota de código no otimizador de imagens com SVG | ≥ 15.5.28 |
| `next` | alta | DoS em Server Actions; cache poisoning (moderada) | ≥ 15.5.28 |
| `multer` | alta | vários DoS no upload multipart | ≥ 2.4.0 |
| `body-parser` | alta | DoS com corpo comprimido | versão nova |
| `sharp` | alta | falha no librsvg (SVG) | ≥ 0.35.5 |
| `zod` | alta | consumo de memória em coleções grandes | versão nova |
| `postcss`, `source-map-js`, `deepmerge-ts` | alta/moderada | build/ferramentas | versão nova |

O painel não usa `next/image` nem libera SVG remoto, e o otimizador respondeu 400 para uma
imagem comum — a exposição real da crítica é baixa, mas a atualização é de correção (15.5.x) e
deve entrar já. Não há Dependabot nem `audit` no CI (`.github/workflows/ci.yml`).

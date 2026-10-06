# 17 — Entrada em produção

Checklist para colocar o primeiro cliente pagante no ar. Separado entre **o que só você
pode fazer** (contas, chaves, domínio, cartão) e **o que é trabalho no código/servidor**.

---

## 1. Stripe

Você **não precisa criar produto nem preço na mão** — `pnpm stripe:sync` cria um Product e
um Price recorrente para cada plano do banco e guarda o `stripePriceId`. É idempotente.

### O que você faz

1. Criar a conta em `dashboard.stripe.com` (se ainda não tem).
2. **Modo teste** (chave no topo do painel): copiar a chave secreta `sk_test_…`.
3. Criar o webhook em *Developers → Webhooks*:
   - URL de teste local: use `stripe listen` (abaixo) — não precisa de endpoint público.
   - URL de produção: `https://api.SEUDOMINIO/webhooks/stripe`
   - Eventos: `checkout.session.completed`, `customer.subscription.created/updated/deleted`,
     `invoice.created/paid/payment_failed/finalized/voided`.
   - Copiar o *signing secret* `whsec_…`.
4. Para **produção**: ativar a conta (dados da empresa, conta bancária) e repetir com as
   chaves `sk_live_…`. A ativação é o passo que pode demorar — comece por ele.

### Variáveis

```bash
STRIPE_SECRET_KEY=sk_test_...      # sk_live_... em produção
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CURRENCY=brl
```

### Testar local

```bash
stripe login
stripe listen --forward-to localhost:4000/webhooks/stripe   # imprime o whsec_ de teste
pnpm stripe:sync                                            # cria produtos e preços
```

Cartão de teste do Stripe: `4242 4242 4242 4242`, validade futura, CVC qualquer.
Recusa proposital: `4000 0000 0000 0002` — serve para ver falha de pagamento, carência e
suspensão funcionando.

---

## 2. Meta (API oficial)

**Leia isto antes de contar com a Meta para a estreia:** a verificação do negócio pode levar
dias ou semanas, e não depende de nós. Se o primeiro cliente entra na semana que vem, o
caminho realista é **Evolution (QR)**, que já está rodando, e migrar para a oficial depois —
a troca é uma config por número, sem downtime.

### O que você faz, quando for a hora

1. Conta no **Meta Business Manager** e verificação do negócio (documentos da empresa).
2. App do tipo *Business* em `developers.facebook.com` → produto **WhatsApp**.
3. **WABA** (WhatsApp Business Account) e um número de telefone que **não** esteja em uso
   no app do WhatsApp comum.
4. **System User** com permissão na WABA → gerar **token permanente**.
5. Anotar: `accessToken`, `phoneNumberId`, `wabaId` — são o que se preenche no cadastro do
   número, dentro do Atendo (ficam criptografados no banco).
6. Webhook do app: `https://api.SEUDOMINIO/webhooks/meta`, com o *Verify Token* que você
   definir, e assinar o campo `messages`.
7. Copiar o **App Secret** do app.

### Variáveis

```bash
META_GRAPH_VERSION=v21.0
META_APP_SECRET=...            # valida a assinatura do webhook
META_WEBHOOK_VERIFY_TOKEN=...  # string que você inventa e repete no painel da Meta
```

> A Meta **cobra por conversa** (24h), por categoria. Isso entra em `provider_pricing` e é o
> que alimenta o relatório de margem — ver [05](05-planos-e-cobranca.md).

---

## 3. Resend (e-mails)

Esqueci a senha, alerta de plano e aviso de cobrança dependem disto. **O convite não**: a
tela de Equipe gera um link copiável para mandar por WhatsApp ([12](12-contas-e-email.md)),
então dá para estrear sem e-mail e configurar depois.

1. Conta em `resend.com`, chave `re_…`.
2. **Domínio verificado** (registros SPF/DKIM no DNS). Sem isso a entrega cai em spam.
3. `MAIL_FROM` com esse domínio: `Atendo <nao-responda@seudominio.com.br>`.

---

## 4. Infraestrutura

### O que você providencia

- **Servidor**: VPS Linux com Docker. Para começar (até ~50 clientes), 4 vCPU / 8 GB / 80 GB
  SSD resolve. Cada instância Evolution consome ~100 MB de RAM — ver [11](11-infra-producao.md).
  Opções: Hetzner (melhor preço), DigitalOcean/Vultr (região em São Paulo) ou **Oracle Cloud
  Always Free** (ver abaixo).
- **Domínio** e acesso ao DNS.
- **Registros DNS** apontando para o IP do servidor:
  - `app.seudominio.com.br` → painel
  - `api.seudominio.com.br` → API e webhooks
- **Backup**: onde guardar (S3/R2 é o mais simples).

#### Sem domínio ainda? Use `sslip.io`

O domínio costuma ser o item mais lento (no `.br`, o Registro.br pode travar por associação
de CPF a outro provedor). Ele **não precisa bloquear o deploy**: o `sslip.io` resolve
qualquer IP escrito no próprio nome, sem cadastro.

```bash
bash scripts/prepare-prod.sh 163-176-200-252.sslip.io   # o IP com hífens
```

Isso dá `app.163-176-200-252.sslip.io` e `api.163-176-200-252.sslip.io`, e como são
hostnames públicos reais o **Caddy emite certificado Let's Encrypt normalmente**. Não é
detalhe estético: Meta e Stripe recusam webhook sem HTTPS confiável, então com IP cru você
não conseguiria nem conectar o WhatsApp.

Quando o domínio real sair, troque `APP_DOMAIN`, `API_DOMAIN`, `API_PUBLIC_URL`,
`WEB_ORIGIN`, `NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_WS_URL` no `.env.production` e suba de
novo. **Não rode `prepare-prod.sh` de novo** — ele geraria uma `ENCRYPTION_KEY` nova e as
credenciais dos números já conectados viram lixo. Resta reconfigurar o webhook na Meta.

### O que roda no servidor

Um comando prepara tudo o que não depende de terceiros — segredos aleatórios, URLs e
domínios:

```bash
bash scripts/prepare-prod.sh seudominio.com.br
```

Ele gera `.env.production` (modo 600), incluindo `APP_DOMAIN` e `API_DOMAIN`. Não
sobrescreve se o arquivo já existir.

O `infra/Caddyfile` **não é editado por script**: ele lê `{$APP_DOMAIN}` e `{$API_DOMAIN}`
do ambiente. É versionado, e um deploy sincroniza a versão do repositório por cima — um
Caddyfile remendado no servidor seria desfeito no deploy seguinte, derrubando o HTTPS.

Depois é só preencher as chaves de terceiros (Stripe, Resend, IA, backup) e subir. O envio
do código e o `up` estão em um script só, que roda do seu computador:

```bash
bash scripts/deploy.sh ubuntu@IP_DO_SERVIDOR
```

O `deploy.sh` obedece o `.gitignore` e exclui `infra/volumes` e `.env.production`. **Isso
não é detalhe:** um `rsync` ingênuo leva `infra/volumes/` junto, e o Postgres do servidor
sobe com o banco de desenvolvimento dentro (autenticação falha, porque a senha é a antiga).
Pior, vai junto a sessão da Evolution — e duas instâncias com a mesma sessão derrubam o
número de WhatsApp.

**Branches: `main` = produção, `develop` = desenvolvimento.** O trabalho do dia a dia vai na
`develop` (feature maior: `feat/...` saindo dela e voltando para ela). Para publicar, merge da
`develop` na `main` e deploy **da `main`**. O `deploy.sh` recusa outra branch ou alteração não
commitada, porque o `rsync` manda a pasta, não um commit — sem a trava, sobe para produção
código que não está no git. Emergência consciente: `DEPLOY_ANY_BRANCH=1`. O CI roda nas duas.

```bash
git checkout main && git merge --ff-only develop && bash scripts/deploy.sh ubuntu@IP_DO_SERVIDOR
git checkout develop
```

O seed roda uma vez, com o arquivo já compilado na imagem:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production exec api node dist/prisma/seed.js
```

> `npx prisma db seed` **não funciona em produção**: ele chama `tsx`, que é devDependency e
> não existe na imagem final. Pela mesma razão o `prisma` saiu de `devDependencies` — sem
> ele instalado, o `npx` baixava o pacote do registro público em tempo de execução e um dia
> trouxe um release candidate incompatível, derrubando a API em loop de restart. A imagem
> chama `./node_modules/.bin/prisma` pelo caminho explícito: se faltar, falha alto.

> **Guarde o `.env.production`.** Perder a `ENCRYPTION_KEY` torna ilegíveis as credenciais
> dos números já cadastrados — todos precisariam ser reconectados por QR.

### Ordem que funciona

0. No servidor limpo: `bash scripts/bootstrap-server.sh` (Docker, portas, swap, fuso)
1. Contratar servidor e domínio
2. Apontar no DNS: `app.` e `api.` → IP do servidor (registro A). **Espere propagar** — o
   Caddy só emite o certificado quando o domínio já resolve para o servidor
3. Instalar Docker no servidor e clonar o repositório
4. `bash scripts/prepare-prod.sh seudominio.com.br`
5. Preencher as chaves de terceiros
6. Subir e rodar o seed
7. Entrar como dono, criar o cliente, conectar o número dele por QR
8. Configurar webhook do Stripe para `https://api.seudominio.com.br/webhooks/stripe`

O Caddy emite o certificado HTTPS sozinho, desde que o DNS já aponte para o servidor.

> **Atenção:** `NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_WS_URL` entram no **build** do painel.
> Mudar o domínio da API depois exige rebuild da imagem web.

---

## 5. Antes de faturar alguém — ainda falta

| | Item | Risco se ignorar |
|---|---|---|
| ✅ | **Backup automático do Postgres**, testado com restauração | feito — ver abaixo |
| ✅ | **Backup do volume da Evolution** | feito — ver abaixo |
| ✅ | **Stripe exercitado ponta a ponta** em modo teste | feito — caminho feliz e falha de pagamento |
| 🟡 | **Resend com domínio verificado** | deixou de ser bloqueador: o convite tem link copiável ([12](12-contas-e-email.md)). Ainda necessário para "esqueci minha senha" e avisos de cobrança |
| ⬜ | **Sentry ligado** (`SENTRY_DSN`) | Erro em produção só aparece quando o cliente reclama |
| ⬜ | **Alerta de número caído** | A sessão cai de madrugada e ninguém percebe até de manhã |

Backup e Stripe são os dois que eu não colocaria um cliente pagante sem ter.


---

## 6. Backup — como funciona

O serviço `backup` do compose de produção roda **uma vez por dia** e guarda:

| O quê | Por que importa |
|---|---|
| `atendo.dump` | conversas, mensagens, contatos, agendamentos, fluxos, cobrança |
| `evolution.dump` | estado das instâncias |
| `evolution-instances.tar.gz` | **credenciais de pareamento** — sem isto, todo número precisa ler o QR de novo |
| `storage.tar.gz` | mídia, só quando `STORAGE_DRIVER=local` (com S3/R2 a durabilidade é do provedor) |

### Envio remoto (obrigatório na prática)

Backup que só existe no mesmo servidor não protege contra **perder o servidor** — que é o
cenário principal. Configure:

No `.env.production` (exemplo com Cloudflare R2, que tem 10 GB grátis; funciona igual com
S3, B2, Wasabi, MinIO):

```
BACKUP_S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_REMOTE=r2:atendo-backups
```

Não há arquivo de configuração do rclone: ele lê `RCLONE_CONFIG_R2_*`, que o compose monta a
partir dessas variáveis. Isso é deliberado — montar um arquivo único como volume é frágil:
**se o arquivo não existe no host, o Docker cria um diretório no lugar** e o envio falha em
silêncio, com o backup parecendo saudável.

Para conferir sem esperar o ciclo diário:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production exec backup sh /usr/local/bin/backup.sh
docker compose -f infra/docker-compose.prod.yml --env-file .env.production exec backup rclone ls r2:atendo-backups
```

Sem `BACKUP_REMOTE` o serviço avisa no log a cada execução, de propósito.
`BACKUP_KEEP_DAYS` (padrão 14) apaga as cópias antigas local e remotamente.

### Restaurar

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production stop api worker
docker compose -f infra/docker-compose.prod.yml --env-file .env.production \
  exec backup sh /usr/local/bin/restore.sh /backup/20260929-030000
docker compose -f infra/docker-compose.prod.yml --env-file .env.production restart evolution
docker compose -f infra/docker-compose.prod.yml --env-file .env.production start api worker
```

`restore.sh` é **destrutivo**: substitui os bancos atuais. Pare a API e o worker antes.

### Testado

Em 2026-09-29 o backup foi gerado e restaurado num banco limpo: 21 conversas, 229 mensagens,
18 contatos, 5 agendamentos e 7 fluxos conferem com o original, e os desfechos de venda e a
credencial criptografada do número vieram íntegros.

**Faça este teste de novo depois do primeiro deploy**, com os dados reais: backup que nunca
foi restaurado não é backup.


---

## 7. Stripe — o que já foi verificado (2026-09-29)

Com chave de teste e `stripe listen`:

| Passo | Resultado |
|---|---|
| `pnpm stripe:sync` | criou Product + Price dos 3 planos e gravou o `stripePriceId` |
| Checkout do plano Starter com cartão `4242…` | assinatura criada, `customer` gravado no tenant |
| Webhooks | 5 eventos recebidos e processados (200) |
| Assinatura no banco | `active`, plano Starter, ciclo até 29/10 |
| Fatura | R$ 97,00, status `paid`, com link do Stripe |

### Falha de pagamento → carência → suspensão → reativação

Verificado com **test clock** do Stripe (adianta o relógio para provocar a renovação):

| Passo | Resultado |
|---|---|
| Assina com cartão bom | `active` |
| Cliente troca para um cartão que recusa, relógio avança 1 mês | renovação falha → **`past_due`**, carência de 5 dias gravada, e-mail "a cobrança falhou" disparado |
| Carência vence e o job diário roda | **`suspended`**, e-mail de suspensão disparado |
| Cliente atualiza o cartão e paga a fatura | volta a **`active`**, carência limpa |

> Ao testar, **nunca** mande número de cartão cru para a API do Stripe, nem em modo teste:
> ele recusa e dispara um alerta de segurança para o dono da conta. Use os tokens de teste
> (`tok_visa`, `tok_chargeCustomerFail`).

Um detalhe que só apareceu aqui: cada tentativa de cobrança gera uma fatura, então o mês
teve quatro. Foi o que revelou o bug de faturas colidindo por período (abaixo).

### Dois problemas encontrados e corrigidos

**`pnpm stripe:sync` nunca teria funcionado.** Rodava com `tsx`, que não emite
`design:paramtypes` — sem esses metadados a injeção de dependência do Nest não resolve nada
e o contexto nem sobe. Passou a compilar com `tsc` numa pasta própria (`.scripts-build`),
separada do `dist` do watcher, pelo mesmo motivo do `.next-build` da web.

**Faturas eram uma por mês por cliente.** A tabela tinha `unique(tenantId, period)` e a
segunda fatura do ciclo sobrescrevia a primeira — acontece sempre que o cliente **troca de
plano no meio do mês** (o Stripe emite uma fatura de proration). No teste, três faturas de
setembro viraram uma só, e a de R$ 97 paga foi substituída. Agora cada fatura do Stripe é
uma linha, identificada pelo `externalId`.


---

## 8. Oracle Cloud Always Free — viável para começar

A camada gratuita da Oracle dá **4 cores ARM (A1.Flex) + 24 GB de RAM + 200 GB**, o que é
mais do que o servidor pago sugerido acima. Tecnicamente funciona: **todas as imagens que
usamos têm `arm64`**, incluindo `evoapicloud/evolution-api` — verificado em 2026-09-29 com
`docker manifest inspect`. O compose constrói na própria máquina, então não há nada a mudar.

### O que aceitar junto

| Risco | Como conviver |
|---|---|
| **Sem SLA** — recurso gratuito, a Oracle não deve disponibilidade a você | backup remoto + deploy automatizado: se cair, sobe em outro provedor e restaura |
| **Capacidade ARM escassa** em algumas regiões | se a instância já existe, o problema já passou |
| **Recuperação de instâncias ociosas** em contas somente-free | **converter a conta para Pay As You Go**: o Always Free continua gratuito e a recuperação deixa de valer |
| **Portas fechadas por dentro** | a imagem Ubuntu da Oracle traz iptables restritivo; abrir só a security list da VCN **não basta**. `bootstrap-server.sh` resolve — é o motivo nº 1 de "apontei o DNS e não abre" |

### Regras para usar gratuito com cliente pagante

1. **`BACKUP_REMOTE` configurado** — em servidor gratuito isso deixa de ser recomendação.
   O backup precisa estar fora da máquina que pode sumir.
2. **Conta em Pay As You Go**, mesmo sem gastar nada.
3. **Migrar quando a receita justificar** — com 3 ou 4 clientes, um servidor pago custa uma
   fração da receita e traz SLA.

Com o backup automatizado e o `prepare-prod.sh`, o custo de trocar de provedor é de menos de
uma hora. É isso que torna o risco do gratuito aceitável no começo — e não o contrário.

### Migrar de ARM para x86 depois

Sem armadilha: o dump do Postgres (formato `custom`) e o tar das sessões da Evolution são
**independentes de arquitetura**, e as imagens são reconstruídas no destino pelo próprio
compose. A migração é: backup → `bootstrap-server.sh` e `prepare-prod.sh` no servidor novo →
`restore.sh` → apontar o DNS.

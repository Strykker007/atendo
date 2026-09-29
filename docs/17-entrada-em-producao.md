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

Convite de equipe, esqueci a senha, alerta de plano e aviso de cobrança dependem disto.
Sem chave, os e-mails só aparecem no log — o que em produção significa **cliente sem
convite e sem recuperação de senha**.

1. Conta em `resend.com`, chave `re_…`.
2. **Domínio verificado** (registros SPF/DKIM no DNS). Sem isso a entrega cai em spam.
3. `MAIL_FROM` com esse domínio: `Atendo <nao-responda@seudominio.com.br>`.

---

## 4. Infraestrutura

### O que você providencia

- **Servidor**: VPS Linux com Docker. Para começar (até ~50 clientes), 4 vCPU / 8 GB / 80 GB
  SSD resolve. Cada instância Evolution consome ~100 MB de RAM — ver [11](11-infra-producao.md).
- **Domínio** e acesso ao DNS.
- **Registros DNS** apontando para o IP do servidor:
  - `app.seudominio.com.br` → painel
  - `api.seudominio.com.br` → API e webhooks
- **Backup**: onde guardar (S3/R2 é o mais simples).

### O que roda no servidor

```bash
cp .env.production.example .env.production      # preencher TUDO
# segredos: openssl rand -base64 32   (JWT_*, ENCRYPTION_KEY, EVOLUTION_API_KEY, senhas)
# domínios em infra/Caddyfile
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
```

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
| ⬜ | **Resend com domínio verificado** | Cliente não recebe convite nem redefinição de senha |
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

1. `cp infra/backup/rclone.conf.example infra/backup/rclone.conf` e preencha (exemplo pronto
   para Cloudflare R2; funciona igual com S3, B2, Wasabi).
2. `BACKUP_REMOTE=r2:atendo-backups` no `.env.production`.

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

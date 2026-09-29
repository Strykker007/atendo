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
| ⬜ | **Backup automático do Postgres**, testado com restauração | Perder conversas e agendamentos do cliente sem volta |
| ⬜ | **Backup do volume da Evolution** | Todos os números precisam parear o QR de novo |
| ⬜ | **Stripe exercitado ponta a ponta** em modo teste | Descobrir que a cobrança não fecha com cliente já dentro |
| ⬜ | **Resend com domínio verificado** | Cliente não recebe convite nem redefinição de senha |
| ⬜ | **Sentry ligado** (`SENTRY_DSN`) | Erro em produção só aparece quando o cliente reclama |
| ⬜ | **Alerta de número caído** | A sessão cai de madrugada e ninguém percebe até de manhã |

Backup e Stripe são os dois que eu não colocaria um cliente pagante sem ter.

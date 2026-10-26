# 31 — Migração para a Meta oficial

Plano para colocar números da **Cloud API (Meta)** no Atendo sem derrubar quem já é atendido.
Passo a passo genérico da Meta em [17](17-entrada-em-producao.md#2-meta-api-oficial); detalhes
do adapter em [04](04-providers-whatsapp.md#meta-cloud-api).

## Situação (2026-10-26)

| Item | Estado |
|---|---|
| Verificação do negócio | **Já aprovada** no Business Manager (portfólio) do sócio. A Meta verifica o portfólio, não o app: site, e-mail e política de privacidade já foram conferidos lá |
| Sistema antigo | **Ainda atende todos os clientes da Meta oficial**, por um app próprio no mesmo portfólio |
| Acesso ao Business Manager | Pendente: o sócio precisa adicionar o Tiago como **administrador** |
| E-mail transacional | Funcionando (Brevo, `no-reply@vogochatplus.com.br`) — [12](12-contas-e-email.md) |
| Webhook do Atendo | `https://api.vogochatplus.com.br/webhooks/meta` |

## Decisão: app novo no mesmo portfólio

O app antigo **não é tocado**. Trocar o webhook ou o token dele derrubaria os clientes atuais.
Um app novo criado no portfólio verificado herda a verificação; não há nova aprovação de
negócio.

Pergunta em aberto: **onde estão as WABAs dos clientes?**
- No portfólio do sócio → o app novo acessa os números direto (acesso padrão basta).
- Num fornecedor (Blip, Z-API, 360dialog…) ou no portfólio de cada cliente → precisa de
  *Advanced Access* (análise do app pela Meta) ou migração da WABA. Reavaliar antes de seguir.

## Passo a passo

### 1. Com o sócio
- Adicionar o Tiago como administrador: *Configurações do negócio → Usuários → Pessoas*.
- Confirmar onde estão as WABAs (acima).

### 2. App novo
1. `developers.facebook.com` → app tipo **Business**, ligado ao portfólio verificado → produto **WhatsApp**.
2. *Configurações → Básico*: URL da política de privacidade (pode ser a do site já aprovado) e
   colocar o app em **Live** — em modo de desenvolvimento só chegam webhooks de teste.
3. **System User** (admin) com acesso total ao app e às WABAs → **token permanente** com
   `whatsapp_business_messaging` e `whatsapp_business_management`.
4. Webhook: `https://api.vogochatplus.com.br/webhooks/meta`, *Verify Token* =
   `META_WEBHOOK_VERIFY_TOKEN` do `.env.production`, assinar `messages`.
5. **App Secret** do app novo em `META_APP_SECRET` no `.env.production` e recriar api/worker:
   `docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --no-build api worker`
   (`restart` não relê o `.env`).

### 3. Primeiro número: de teste, não de cliente
Número novo, fora do sistema antigo: criar no WhatsApp Manager, registrar na Cloud API e
cadastrar no Atendo (`accessToken`, `phoneNumberId`, `wabaId`). Validar envio, recebimento,
templates e mídia antes de mexer em qualquer cliente.

### 4. Migrar cliente a cliente
Ao conectar, o Atendo inscreve o app novo na WABA (`subscribed_apps`). A partir daí **os dois
sistemas recebem as mensagens do número** — se o robô do antigo também responder, o contato
recebe resposta dobrada. Para cada cliente:
1. Combinar a janela com o cliente.
2. Desligar a automação do número no sistema antigo.
3. Conectar o número no Atendo e conferir envio/recebimento/templates.
4. Tirar o número do sistema antigo (desinscrever o app antigo da WABA, se ela for compartilhada).

## Riscos

- Um número só tem um registro na Cloud API; mexer no PIN/registro afeta os dois sistemas.
- Templates são da WABA, não do app: os aprovados continuam valendo no Atendo.
- Cobrança da Meta é da WABA (método de pagamento do portfólio) — não muda com o app novo.

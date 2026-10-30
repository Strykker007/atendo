# Cadastro incorporado da Meta (Embedded Signup)

O cliente conecta o número oficial **sozinho**, sem copiar token nem ID: em **Números → Adicionar
número → Meta Cloud API → Conectar com a Meta** abre uma janela da Meta, ele entra com o Facebook
de quem administra a empresa, escolhe ou cria a conta do WhatsApp (WABA) e o número, confirma, e o
número aparece conectado no painel. O preenchimento manual (token do System User + IDs) continua
disponível no link "preencher manualmente" e é o que se usa para as WABAs que já estão no portfólio
do sócio ([31](31-migracao-meta-oficial.md)).

## Como funciona

1. Front (`components/numbers/MetaSignupButton.tsx`) carrega o SDK do Facebook e chama `FB.login`
   com `config_id` (a configuração do Login para Empresas), `response_type: 'code'`,
   `override_default_response_type: true` e `extras: { setup: {} }` (Embedded Signup v4).
2. A janela manda por `postMessage` (origem `*.facebook.com`) `{ type: 'WA_EMBEDDED_SIGNUP',
   event: 'FINISH', data: { waba_id, phone_number_id } }`; `CANCEL`/`ERROR` viram mensagem na tela.
   Outros `FINISH_*` (só WABA, app do celular) são recusados: sem número para a Cloud API.
3. O callback do login traz o **código** — vale **30 s** — e o front manda tudo para
   `POST /numbers/meta-signup` `{code, wabaId, phoneNumberId, label}` (`numbers.manage`, limite
   `maxNumbers` do plano).
4. API (`MetaProvider.embeddedSignup`): troca o código pelo token de negócio do cliente
   (`GET /oauth/access_token` com `META_APP_ID` + `META_APP_SECRET`), lê o telefone
   (`display_phone_number`), registra o número na Cloud API (`POST /{phone_number_id}/register` com
   um PIN de 6 dígitos novo, guardado criptografado em `providerConfig.pin`) e cadastra pelo mesmo
   caminho do manual — o `connect` inscreve o app na WABA (`subscribed_apps`).
5. Registro recusado (número já com PIN de outro sistema) **não** impede o cadastro: o número entra,
   a tela avisa e o log registra; o envio vai falhar com 133010 até registrar (WhatsApp Manager).

A forma de pagamento é do cliente, no WhatsApp Manager (*Visão geral → Adicionar forma de
pagamento*): sem ela só sai resposta dentro de 24 h, nada de template.

## Coexistência (manter o WhatsApp Business do celular)

Botão **Conectar mantendo o WhatsApp Business do celular**: o número continua no aplicativo
WhatsApp Business (2.24.17+) e passa a funcionar também pela API oficial — é a coexistência
**oficial** da Meta. Não confundir com QR Code (Evolution): somar o QR ao mesmo número não é
suportado e duplicaria tudo.

- Janela: `extras.featureType = 'whatsapp_business_app_onboarding'`, `sessionInfoVersion: '3'`;
  termina com `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (pode vir só o `waba_id` — o servidor acha
  o número em `/{waba}/phone_numbers`). O cliente confirma um código no celular.
- Servidor: troca o código pelo token e **não** chama `/register` (o número já está registrado
  pelo app; registrar derrubaria o celular). `providerConfig.coexist = true`. Depois do `connect`
  (inscrição na WABA) pede `POST /{phone_number_id}/smb_app_data` com `sync_type`
  `smb_app_state_sync` (contatos) e depois `history`. **Cada um só uma vez e até 24 h** após o
  cadastro; perdeu o prazo, o cliente desconecta no app (*Configurações → Conta → Plataforma
  comercial*) e refaz a janela. Falha aqui não desfaz o cadastro: volta em `syncErrors` e no log.
- Webhook (`MetaProvider.parseWebhook`):

  | Campo | Vira |
  |---|---|
  | `smb_message_echoes` | mensagem **enviada pelo celular** (`fromMe`, contato = `to`) — histórico sem automação, como no QR |
  | `history` | `ParsedWebhook.history` → `InboundService.importBackfill`: contato e conversa (nova nasce **encerrada**) criados quando faltam, mensagens importadas sem cobrança, fluxo, não-lidas nem socket. `media_placeholder` é ignorado (a mídia só vem dos últimos 14 dias, em outro webhook). Grupos não vêm |
  | `smb_app_state_sync` | nomes da agenda do aplicativo → `applyContactName` (mesma regra da agenda do QR) |

- Limites da Meta: grupos, listas de transmissão, mensagens temporárias, de visualização única,
  localização em tempo real, chamadas e ferramentas do app (catálogo, etiquetas, saudação e
  ausência) não passam pela API; vazão fixa de 20 mensagens/s. Mensagem do celular não abre nem
  mexe na janela de 24 h da API. Erro `131060` = mensagem para aparelho não suportado — o cliente
  vê no app. Para sair, só pelo app (a API de descadastro não vale).

## O que configurar na Meta (uma vez)

1. **Tornar-se Tech Provider** no app (painel do app → WhatsApp → *Tech Provider* / "Torne-se um
   provedor de tecnologia"): exige o portfólio verificado (o do sócio já é) e **análise do app**
   (*App Review*) pedindo **acesso avançado** a `whatsapp_business_management` e
   `whatsapp_business_messaging` — é o que permite gerenciar WABAs de **outros** portfólios. Sem a
   aprovação, a janela só funciona para quem tem função no app (testes).
2. **Login do Facebook para Empresas → Configurações → Criar configuração**, variação
   **WhatsApp Embedded Signup**; o **ID da configuração** vai em `META_ES_CONFIG_ID`.
3. Em *Login do Facebook para Empresas → Configurações*: **domínios permitidos para o SDK JS** =
   o domínio do painel (`app.vogochatplus.com.br`), com "Login com o SDK do JavaScript" ligado.
4. Webhook do app: além de `messages`, assinar `account_update` (a Meta avisa quando o cliente
   termina o cadastro) e, para a coexistência, `smb_message_echoes`, `history` e
   `smb_app_state_sync`.

## Variáveis (`.env.production`)

```
META_APP_ID=          # ID do app (Configurações do app → Básico)
META_ES_CONFIG_ID=    # ID da configuração do Embedded Signup
META_APP_SECRET=      # já existe (assinatura do webhook) — também troca o código pelo token
```

Sem `META_APP_ID`/`META_ES_CONFIG_ID`/`META_APP_SECRET`, `GET /numbers/meta-signup/config`
devolve `enabled: false` e o botão não aparece (só o manual).

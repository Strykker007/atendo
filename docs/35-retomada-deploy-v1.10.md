# 35 — Retomada: deploy v1.10.0 + mensalidade por Pix (Asaas)

> Roteiro para continuar de onde paramos em **29/10/2026, madrugada**. Siga na ordem e marque cada
> passo. Nada aqui mexe em dado de cliente até o passo 5 — e o passo 5 começa por uma prévia.

## Onde paramos

| Item | Situação |
|---|---|
| `.env.production` no servidor | ✅ chave e token do Asaas preenchidos, `ASAAS_AUTO_ENROLL=false` |
| Deploy v1.10.0 | ✅ no ar (29/10), com a chave do Asaas carregada na API — conferido pelo usuário. Passos 1 a 3 abaixo ficam só como referência |
| Cobrança por Pix para os clientes | ⏸️ a partir da **v1.10.1** fica **escondida** por padrão (botão do dono em Financeiro → Cobrança por Pix). A chave do Asaas pode ficar ativa no `.env.production` — **não precisa comentar**. Até a v1.10.1 subir, os clientes sem CPF/CNPJ veem o aviso (0 tinham migrado em 29/10) |
| Webhook no painel do Asaas | ❌ **próximo passo** (passo 4) — precisa da conta do sócio |
| Migração dos clientes para o Pix | ❌ passo 5, **depois** do webhook |

> ⚠️ Sem o webhook, o pagamento só é reconhecido enquanto o cliente está com a tela do QR aberta. Por
> isso a cobrança fica escondida dos clientes (botão do dono) até o webhook existir.

## Passo 1 — Conferir o Mac

```bash
cd ~/Projetos/atendo
git checkout main
git status --short          # tem que sair vazio
git log --oneline -2        # chore(release): v1.10.0 / Merge branch 'develop'
git tag | grep v1.10.0      # tem que existir
```

## Passo 2 — Terminar o deploy (reaproveita a v1.10.0)

Use **`mesma`**: a versão 1.10.0 já foi criada; `recurso` criaria uma 1.11.0 à toa.

```bash
bash scripts/deploy.sh ubuntu@163.176.200.252 mesma
```

O script sobe o código, recria api/worker/web (a API aplica as duas migrações sozinha — só
acrescentam colunas) e, no fim, manda a `main` e a tag para o GitHub. Se falhar, **pare e guarde a
saída** — não rode de novo com `recurso`.

Depois, traga o commit de versão para a `develop`:

```bash
git checkout develop
git merge main              # não use --ff-only: a develop ganhou o commit deste documento
```

## Passo 3 — Conferir produção

```bash
curl -s https://api.vogochatplus.com.br/health          # "version":"1.10.0+…"
ssh -i ~/.ssh/atendo-prod.key ubuntu@163.176.200.252 \
  'docker exec atendo-prod-api-1 sh -c "echo \"\$ASAAS_API_KEY\" | cut -c1-6"'   # tem que dar $aact_
```

- Saiu vazio ou outra coisa no segundo comando: a chave não está entre **aspas simples** no
  `.env.production` (`ASAAS_API_KEY='$aact_prod_…'`). Corrija e recrie: `docker compose -f
  infra/docker-compose.prod.yml --env-file .env.production up -d --no-build api` e depois `worker`.
- Entre (“entrar como”) na **Ultra popular - Droga Rede**: Equipe, Contatos e Transmissões devem
  continuar como antes (a separação por empresa nasce desligada).

## Passo 4 — Webhook no painel do Asaas (conta do sócio)

Não há nada a reativar no servidor: a chave já está no `.env.production`. Se em algum momento ela
foi comentada (`#ASAAS_API_KEY=`), tire o `#` e recrie api e worker.

No **site do Asaas** (asaas.com, conta de produção) → menu do usuário → **Integrações → Webhooks →
Adicionar**:

- **URL:** `https://api.vogochatplus.com.br/webhooks/asaas`
- **Token de autenticação:** o mesmo valor de `ASAAS_WEBHOOK_TOKEN` (no servidor:
  `grep ASAAS_WEBHOOK_TOKEN ~/atendo/.env.production`)
- **Versão da API:** v3 · **Webhook ativado** · **Fila de sincronização ativada** · envio sequencial
- **Eventos:** todos de **Cobranças** (`PAYMENT_*`) e de **Assinaturas** (`SUBSCRIPTION_*`)
- E-mail para avisos de falha: o seu

Confira também: a conta tem **chave Pix cadastrada** (Pix → Minhas chaves) — sem ela o Asaas não gera
o QR.

Depois do webhook, em **Financeiro → Cobrança por Pix → Liberar para os clientes** — só então o
aviso de CPF/CNPJ e o “Assinar” pelo Asaas aparecem. Faça o passo 5 na mesma sessão.

## Passo 5 — Migrar os clientes para o Pix automático

1. Painel como dono do sistema → **Financeiro → Cobrança por Pix → Ver prévia**. Nada é criado no
   Asaas. Confira: valor de cada um (os 17 com preço negociado), 1º vencimento (o mesmo de hoje) e
   quem ficou de fora (“Falta CPF/CNPJ” — esses veem o aviso no painel).
2. **Migrar N cliente(s)** → confirmar. Quem vence em até 5 dias recebe o e-mail com o Pix na hora.
3. Deu certo: no servidor, `ASAAS_AUTO_ENROLL=true` no `.env.production` e recriar api e worker (comando
   do passo 3). A partir daí, quem informar o CPF/CNPJ entra sozinho.

Regras completas: [05 — Migração para o Asaas](05-planos-e-cobranca.md#migração-para-o-asaas) e
[Lembretes da mensalidade](05-planos-e-cobranca.md#lembretes-da-mensalidade).

## Passo 6 — Depois

- Administradoras de condomínio: ligar **Separar também equipe, contatos e transmissões por empresa**
  (Configurações → Empresa → Empresas; só o admin da conta). Farmácias: **não** ligar.
- Política de privacidade (`apps/site`, `/privacidade`) ainda não tem deploy — o site não está no
  `docker-compose.prod.yml` ([21 — Site](21-site.md)). Publicar por onde o `vogochat.com.br` está hoje
  antes de preencher o app da Meta ([31](31-migracao-meta-oficial.md)).
- API oficial da Meta: `META_APP_SECRET` está **vazio** no servidor — preencher antes do primeiro
  número oficial.

## Se algo der errado

- **Deploy falhou no meio:** a versão anterior continua no ar (os containers só são trocados no
  fim). Guarde a saída e retome com `mesma`.
- **Precisar voltar a versão:** a 1.9.1 ignora as colunas novas — basta publicar a tag anterior. As
  migrações não precisam ser desfeitas.
- **Migração de cliente deu erro** (aparece na lista com o motivo): os outros seguem migrados; o que
  falhou continua na cobrança manual e pode ser tentado de novo pelo mesmo botão.

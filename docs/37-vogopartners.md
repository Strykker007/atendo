# 37 — VogoPartners (programa de parceiros)

Parceiro que **cadastra e cuida de clientes** e recebe uma parte do que eles pagam. **Um nível só**: não há rede, indicação de parceiro nem override — cada parceiro ganha apenas sobre os próprios clientes.

Código: `apps/api/src/modules/partners/` (regras puras em `commission-rules.ts` e `packages/shared/src/partners.ts`, autenticador em `totp.ts`), telas `apps/web/src/app/(app)/parceiros` (dono) e `apps/web/src/app/(app)/parceiro/*` (portal). Testes: `apps/api/test/partners-*.test.ts`.

## Regras

| Regra | Como funciona |
|---|---|
| Quem é do parceiro | Cliente cadastrado pelo parceiro fica com ele **até o cancelamento** (`tenants.partnerId`). O dono também pode vincular/desvincular à mão (Parceiros → ficha → Clientes) |
| Desde quando conta | Só pagamentos feitos **a partir do vínculo** (`partnerAttributedAt`): cliente antigo vinculado agora não gera comissão retroativa |
| Mensalidade | % por **faixa de clientes ativos**. Padrão: 20% a partir de 0. Faixas próprias por parceiro, quantas quiser (ex.: 0+ → 20%, 75+ → 25%). A maior faixa alcançada vale para **todos** os clientes dele naquele mês. **Paga por mês** |
| Instalação | % sobre a taxa de instalação paga. Padrão 30%, configurável no programa e por parceiro. **Paga por semana** (segunda a domingo) |
| Base | Sempre o que o cliente **pagou**: fatura paga (Asaas/Stripe, sem o excedente), recebido por fora (categoria *Mensalidade* ou *Instalação* com cliente) e a ativação paga. Desconto reduz a base; inadimplente não gera nada |
| Cliente ativo | No ar, assinatura `active`/`past_due`, plano pago e ativação já paga. Contado na apuração e guardado no pagamento |
| Estorno | Pagamento estornado/apagado: se a comissão ainda não foi autorizada, sai da conta; se já foi, entra uma linha negativa no ciclo seguinte (janela de 120 dias) |
| Mínimo | `minPayout`: abaixo disso não gera pagamento, acumula |

### O que o parceiro pode e não pode

- **Pode**: cadastrar cliente (plano do catálogo, modelo de perfil, admin), **entrar no cliente para configurar** (vira admin daquele cliente), gerar a **cobrança de ativação**, ver seus clientes, faixa, extrato e pagamentos.
- **Não pode**: mexer em valor (plano, personalização, promoção, taxa de instalação), escolher plano personalizado, trocar a própria chave Pix, ver outros clientes, nem nada das telas de dono. Dentro do cliente ele **não** tem os poderes do dono "entrando como" (ritmo de envio, custo da linha, falar como Suporte) — ver `isOwnerSession()`.
- Cobrança de ativação do parceiro: itens **travados** — *Instalação e configuração* = `partner_settings.setupFee` (dono define) + *1ª mensalidade* = valor contratado do plano. Ele só informa CPF/CNPJ do cliente e o vencimento. A conta configura tudo mas só envia depois de pagar ([05](05-planos-e-cobranca.md#cobrança-de-ativação)).

## Como a comissão nasce

`PartnerCommissionsService.sync()` lê o que foi **pago** e grava uma linha em `partner_commissions` por pagamento × tipo. Idempotente (`@@unique([sourceType, sourceId, kind])`): roda ao abrir a tela, o portal e na apuração, sem duplicar.

| Origem | Gera |
|---|---|
| `activation_charges` paga | instalação (itens `setup`) + mensalidade (itens `first_month`), desconto rateado; "outros" não geram. A fatura espelhada da ativação não conta de novo |
| `invoices` paga | mensalidade sobre `baseAmount` (sem excedente) |
| `finance_entries` de entrada com cliente | `mensalidade` → mensalidade; `instalacao` → instalação |

Instalação nasce com `rate`/`amount` (o % é fixo). Mensalidade nasce só com a base: o % depende da faixa do mês e é aplicado na apuração.

## Pagamento

1. **Apurar** (Parceiros → Pagamentos): *Mensalidades · mês passado* ou *Instalações · semana passada*. Só ciclo **terminado**. Agrupa por parceiro as comissões em aberto até aquele ciclo (sobras de ciclos anteriores entram junto), aplica a faixa (mensalidade) e cria o pagamento em **Apurado**. Apurar de novo refaz enquanto ninguém autorizou.
2. **Conferir**: cada pagamento abre o extrato linha a linha (cliente, data, origem, valor pago, %, comissão).
3. **Autorizar e pagar**: marca os pagamentos e confirma com **um** código do autenticador. Cada um é conferido de novo no servidor (situação, chave Pix, carência, teto do dia). Acima de `secondApprovalAbove`, fica em *Falta 2ª autorização* até outro dono confirmar.
4. **Pix**: autorizado → transferência no Asaas (`POST /transfers`, `externalReference = partner-payout:<id>`) → *Enviando Pix*. O webhook `TRANSFER_DONE` marca **Pago**; `TRANSFER_FAILED/CANCELLED` marca **Falhou** com o motivo.
5. Sem Asaas configurado (ou Pix feito pelo app do banco): fica *Autorizado* e o dono dá **Paguei por fora** (com código).
6. **Falhou**: *Tentar de novo* (com código). Se o Asaas não respondeu (`UNKNOWN`), exige confirmar no painel do Asaas que o Pix não saiu — nunca repete às cegas.
7. **Desfazer apuração**: enquanto não saiu dinheiro; as comissões voltam para o próximo ciclo.

O parceiro vê só *Em processamento* ou *Pago* no extrato dele.

### No fechamento financeiro

Pago → saída **já paga** na categoria de fábrica *Comissões de parceiros* (`comissao_parceiros`, grupo Custos do serviço), competência = mês do ciclo (instalação: mês do domingo da semana), uma por pagamento (`finance_entries.partnerPayoutId` único). Entra no resultado **antes** da divisão entre sócios ([36](36-fechamento-financeiro.md)). Se o mês já estiver fechado, aparece o aviso de resultado novo — reabrir e fechar de novo atualiza.

## Segurança

O objetivo: alguém que invadir o sistema (ou roubar uma senha) **não consegue tirar dinheiro**, e o financeiro continua ágil (um código autoriza um lote).

| Trava | O que impede |
|---|---|
| **Autenticador (TOTP)** de quem autoriza — Parceiros → Segurança. Senha para cadastrar; código para confirmar | Senha vazada não basta: falta o celular. Sem autenticador, nenhum pagamento sai |
| Código exigido em: autorizar, repetir, baixa manual, **trocar chave Pix**, afrouxar travas | Toda ação que muda para onde/quanto dinheiro vai |
| Código de **uso único** e **5 erros = 15 min** de bloqueio (Redis) | Reuso de código e força bruta |
| **Carência** de `pixKeyCooldownHours` (24h) após trocar a chave + e-mail a **todos os donos** + autorizações pendentes voltam a *Apurado* | Invasor troca a chave e paga na hora |
| Chave **congelada** na autorização; 2º dono confere a mesma chave | Troca no meio do caminho |
| **2º dono** acima de `secondApprovalAbove` | Um único acesso comprometido |
| **Teto diário** (`dailyLimit`) | Vazamento grande num dia |
| Transições condicionais no banco (`updateMany where status`) | Duplo clique, duas abas, webhook + tela: o mesmo Pix duas vezes |
| **Validação de saque do Asaas** (`/webhooks/asaas/transfer-validation`): o Asaas pergunta antes de cada transferência; só aprova `partner-payout:<id>` em *Enviando* com o mesmo valor e chave. Recusa avisa os donos | Quem roubar a **chave da API do Asaas** não tira dinheiro por fora |
| Parceiro não troca a própria chave; portal filtra tudo pelo `partnerId` do token | Parceiro desviando ou vendo dados de outro |
| Auditoria (`partner_events`): quem, quando, IP | Rastreio e conferência |

### Ativar a validação de saque no Asaas

1. Gere um token (`openssl rand -hex 32`) e ponha em `ASAAS_TRANSFER_VALIDATION_TOKEN` na API.
2. No Asaas: **Integrações → Mecanismos de segurança → Validação de saque via webhook**: URL `https://<api>/webhooks/asaas/transfer-validation`, mesmo token.
3. Ative também o webhook de **transferências** (eventos `TRANSFER_*`) na URL `/webhooks/asaas` existente.
4. Teste no sandbox: autorize um pagamento pequeno e confira em Auditoria *Asaas: saque validado*. **Atenção:** com a validação ligada, toda transferência por API precisa passar por aqui — saques manuais feitos pelo painel do Asaas seguem o fluxo do próprio Asaas.

> O formato do corpo da validação (`{type: "TRANSFER", transfer: {...}}` → `{status: "APPROVED" | "REFUSED"}`) e o campo `externalReference` em transferências seguem a documentação do Asaas — **confirmar no sandbox antes de ligar em produção**.

Perdeu o celular: outro dono não consegue desativar o seu autenticador; use a chave guardada no cadastro para restaurar no app novo, ou zere `users.totpSecret`/`totpConfirmedAt` no banco (com registro do motivo).

## Portal do parceiro

Login com `role = partner` (convite por e-mail criado na ficha do parceiro). Menu: **Painel** (clientes ativos, faixa e quanto falta para a próxima, previsão do mês, instalações da semana, a receber, recebido), **Meus clientes** (novo cliente, *Configurar* = entrar no cliente, *Ativação*) e **Extrato**. Parceiro suspenso/encerrado não entra (login e refresh recusam) e o "entrar" no cliente é recusado.

## API

Dono do sistema (`super_admin`/dono por marcação):

| Método | Rota | O quê |
|---|---|---|
| GET/POST | `/partners` | Lista (com faixa atual, previsão do mês, instalações da semana, a pagar) / cria `{name, document?, email?, phone?, setupRate?, notes?, login?: {name, email}}` |
| GET/PATCH | `/partners/:id` | Ficha (clientes, logins, faixas, histórico) / edita (inclui `status`) |
| PUT | `/partners/:id/pix-key` | `{pixKey, pixKeyType, code}` |
| PUT | `/partners/:id/tiers` | `{tiers: [{minClients, rate}]}` — vazio volta às padrão |
| POST | `/partners/:id/logins` · `/:userId/invite-link` | Cria login (convite) · novo link |
| PATCH | `/partners/:id/logins/:userId` | `{isActive}` |
| GET/PUT | `/partner-program/settings` | Configuração; mudar carência/2º dono/teto exige `code` |
| PUT | `/partner-program/tiers` | Faixas padrão |
| GET | `/partner-program/tenants/unassigned?q=` | Clientes sem parceiro |
| PUT | `/partner-program/tenants/:tenantId` | `{partnerId \| null}` — vincula/desvincula |
| GET | `/partner-program/events` | Auditoria |
| GET · POST | `/partner-program/security/totp` · `/setup {password}` · `/confirm {code}` · `/disable {password, code}` | Autenticador de quem está logado |
| GET | `/partner-payouts?status&kind&partnerId` · `/:id` | Pagamentos / detalhe com as linhas |
| POST | `/partner-payouts/apurar` | `{kind: recurring\|setup, period?}` (padrão: último ciclo terminado) |
| POST | `/partner-payouts/approve` | `{ids, code}` → resultado por pagamento |
| POST | `/partner-payouts/:id/retry` · `/:id/paid` | `{code, confirmNotSent?}` · `{code, date?}` |
| DELETE | `/partner-payouts/:id` | Desfaz a apuração (só o que não saiu) |

Portal (`role = partner`, rotas `@PartnerOk`): `GET /partner/me`, `GET/POST /partner/clients`, `GET /partner/plans`, `GET /partner/templates`, `GET/POST /partner/clients/:id/activation` (`{document?, dueDate?}`), `GET /partner/statement?kind`. Entrar no cliente: `POST /tenants/:id/impersonate` (só cliente dele).

## Viabilidade (referência)

Com ticket de R$ 297, imposto 11–15%, Asaas R$ 1,99/Pix, infra ~R$ 5 e suporte ~R$ 20 por cliente, a comissão de 20% deixa **~56–60%** da mensalidade para a Vogo antes de folha e pró-labore; 25% deixa ~51–55%. A instalação a 30% é paga uma vez por cliente. Conta antes de mudar faixas: o custo variável real do produto é baixo (Meta só cobra template; Evolution é servidor), então a comissão é o maior custo variável — revise a margem por plano em Planos/Financeiro ao criar faixas acima de 25%.

## Limites

- A faixa é a do **dia da apuração** (clientes ativos naquele momento), não a média do mês.
- Plano anual paga a comissão de uma vez, no mês em que o cliente paga o ano.
- Comissão de "cliente que voltou" depois de cancelar: o vínculo continua até o dono desvincular; desvincule se ele voltar por outro canal.
- Estorno depois de 120 dias do pagamento não é detectado sozinho: desfaça à mão (lançamento no fechamento).
- Nota fiscal do parceiro: guarde o número em Observações do lançamento no fechamento (sem anexo). Pagamento a pessoa física (RPA, INSS/IRRF) não é calculado — prefira parceiro com CNPJ e valide com o contador.

## Patentes (ranking)

A patente é a **posição na escada de faixas do próprio parceiro** — como as faixas são
personalizáveis, não é um número fixo de clientes. Regra em `partnerRank`/`partnerRankLadder`
(`packages/shared/src/partners.ts`).

| Patente | Quando |
|---|---|
| Em ativação | ainda não alcançou a primeira faixa (só quando a primeira exige clientes) |
| Vogo Start | primeira faixa (faixa única também é Start) |
| Vogo Pro · Vogo Prime · Vogo Elite | 2ª a 4ª faixa (da 5ª em diante, as do meio viram "Vogo Elite 2", "Vogo Elite 3"…) |
| Vogo Legend | sempre a última faixa, quando há mais de uma |

Telas: lista de parceiros (selo, % e barrinha até a próxima), ficha do parceiro e painel do
parceiro (`RankCard`: "Faltam 3 clientes ativos para Vogo Prime (25%)", barra de progresso e a escada).
A patente é só apresentação: o cálculo da comissão continua sendo `tierRate`.

## Testar localmente

`apps/api/scripts/vogopartners-dev.ts` (recusa rodar se o `DATABASE_URL` não for local). Tudo que
ele cria tem prefixo `vp-seed-`, e só isso é apagado.

| Comando (`cd apps/api && npx tsx scripts/vogopartners-dev.ts …`) | O que faz |
|---|---|
| `seed` | Apaga o seed anterior e cria 10 parceiros (faixas próprias, instalação personalizada, um suspenso, um sem chave Pix, um com chave trocada agora — bloqueado 24h), 52 clientes (ativos, inadimplentes, cancelados, aguardando ativação), faturas pagas/abertas de ~4 meses, instalações e uma fatura **anterior ao vínculo** (não pode gerar comissão). Logins `parceiro1@` e `parceiro2@atendo.local`, senha `parceiro123`. Cria o autenticador do `admin@atendo.local` se ele não tiver |
| `reset` | Desfaz os fechamentos (pagamentos, linhas de comissão, saídas no financeiro, auditoria de pagamento). Os pagamentos dos clientes ficam: dá para apurar tudo de novo |
| `pagar` | Novos pagamentos no último mês e na última semana fechados, para ver o rascunho ser refeito |
| `codigo` | Código atual do autenticador do admin (cada código vale **uma** ação; para a próxima, espere o seguinte) |
| `limpar` | Remove tudo o que o seed criou |

Na primeira apuração, as comissões em aberto de meses anteriores entram no ciclo apurado (`period <= alvo`), com a faixa do dia.
Envio do Pix local usa o Asaas **sandbox**: o webhook de transferência não alcança `localhost`, então o pagamento fica
"processando" — use **Marcar pago manualmente** ou **Cancelar** para seguir o fluxo.

# Empresas e unidades (multi-empresa)

Um cliente (tenant) pode ter várias **empresas/unidades** — matriz, filial Centro, filial Norte.
Cada empresa reúne **números de WhatsApp**; quem é vinculado a ela enxerga só as conversas
desses números e alterna entre as suas unidades pelo seletor no topo do menu.

## Modelo

- `companies` — `id, tenantId, name (único no cliente), cnpj? (só dígitos), description?`.
- `whatsapp_numbers.companyId` — opcional. Um número pertence a **no máximo uma** empresa;
  número sem empresa só é visto por quem não está restrito a empresa.
- `user_companies` — N:N usuário × empresa. **Sem nenhuma linha = todas as empresas**
  (mesma regra de `user_numbers` e `user_departments`: cadastrar a primeira empresa não pode
  trancar a equipe para fora).
- Limite do plano: `PlanLimits.maxCompanies` (ausente/`null` = ilimitado), checado no
  `POST /companies` via `@RequireLimit('maxCompanies')`. Aparece em *Plano e uso* e no
  formulário de planos do dono.

## Como o escopo funciona

A empresa **não** ganha filtro próprio em cada consulta: ela vira **números**, e todo o sistema
já restringe por número (`number-scope.ts`). O `JwtAuthGuard` faz a conversão em toda
requisição (`company-scope.ts`):

1. Empresas permitidas = as de `user_companies` (ou todas, sem vínculo).
2. Header `x-company-id` (o seletor do painel) — ignorado se não for uma empresa permitida.
3. Números efetivos = `user_numbers` ∩ números da empresa ativa (ou da união das permitidas,
   quando a pessoa é restrita e não escolheu uma).
4. Interseção vazia vira `[NO_NUMBER]` (um id que não casa com nada) — lista vazia significa
   "todos" em `number-scope.ts`, e a unidade sem número não pode mostrar as outras.

Cliente sem empresas: nenhuma consulta extra além do cache (`PermissionsService.companyNumbers`,
15 s, limpo ao salvar empresa).

O tempo real não muda: o socket só avisa "algo mudou" e o painel refaz a consulta, que já
vai com o header.

## Painel

- **Seletor** (`components/layout/CompanySwitcher.tsx`, abaixo da marca no menu): some quando
  o cliente não tem empresas. "Todas as empresas" só para quem tem `conversations.view_all`
  (admin/gerente); o atendente escolhe uma de cada vez (cai na primeira automaticamente).
  Trocar de empresa limpa número/conversa abertos e recarrega todos os dados.
  A escolha fica no navegador (`useUI.companyId`) e vai em toda chamada (`lib/api.ts`).
- **Cadastro** em *Configurações → Empresas e unidades* (`settings.manage`): nome, CNPJ,
  descrição, quais números e quais pessoas.
- **Lista de conversas**: o seletor de número mostra só os números da empresa ativa.
- **Pelo dono** (*Clientes → Empresas*, sem "Entrar como"): o mesmo formulário (`CompaniesSection
  tenantId=…`), via `/admin/tenants/:tenantId/companies` (super_admin). O dono **não** esbarra no
  `maxCompanies`: o limite é para o autoatendimento do cliente, e passar dele é decisão do dono — a
  tela mostra o limite do plano e avisa quando o cliente está acima.

## Cobrança

Cada empresa paga de um de dois jeitos (`companies.billingType`), e o cliente escolhe se o preço
escala por empresa (`tenants.billingType`). Só o dono configura; a tela do cliente só mostra.

| Onde | `INDIVIDUAL` | `CONSOLIDATED_GROUP` |
|---|---|---|
| `tenants.billingType` (padrão `INDIVIDUAL`) | preço cheio do plano, com quantas empresas tiver (o comportamento de antes) | **holding**: plano × empresas ativas que herdam a assinatura, nunca menos de 1 |
| `companies.billingType` (padrão `CONSOLIDATED_GROUP`) | assinatura **própria** em `company_subscriptions` (plano, preço contratado, vencimento, status) | herda a assinatura do cliente |

- `companies.isActive` — ativa para cobrança. Inativa não entra na conta do grupo nem gera vencimento.
- `subscriptions.units` — quantas unidades a assinatura do cliente cobra. Valor do ciclo =
  `priceMonth × units` (o `priceMonth` continua sendo o preço contratado **por unidade**).
  `DuesService.syncGroupUnits` recalcula ao criar/excluir empresa, ao mudar a cobrança de uma
  empresa e ao mudar o modo do cliente; com assinatura no Asaas, o valor novo vai para as
  **próximas** cobranças (a já emitida não muda). Se o Asaas falhar, o banco não muda e o job
  diário (`syncAllGroups`) tenta de novo. Checkout, reajuste e MRR já multiplicam por `units`.
- Grupo consolidado com assinatura viva no **Stripe** é recusado (400): o price do Stripe não
  tem quantidade, e o grupo cobraria uma unidade só.
- A assinatura própria define **só preço e vencimento** da unidade: limites de uso (números,
  mensagens, recursos) continuam vindo da assinatura do cliente.
- Assinatura própria `suspended`/`canceled` bloqueia o **envio** dos números daquela empresa
  (`UsageService.canSend(..., numberId)`); o resto do grupo segue. Como nas assinaturas sem
  gateway do cliente, nada suspende sozinho ao vencer: o dono muda o status (o painel mostra
  "Atrasado" pela data).

**Pelo dono:**

- *Clientes → Editar → Cobrança das empresas*: modo do cliente (preço fixo × por empresa).
- *Clientes → coluna Plano*: em cliente com empresas, o seletor é o **plano do grupo** (com
  `× N` quando cobra por unidade) e, embaixo, cada empresa com o plano dela — *do grupo*, o nome do
  plano próprio, *escolher plano* (própria sem plano ainda) ou *inativa*. Clicar numa empresa abre
  **Plano e cobrança** dela direto: usar o plano do grupo ou plano próprio (plano, valor contratado,
  vencimento, status) e ativa para cobrança.
- O mesmo modal abre em *Clientes → Empresas → botão Plano* de cada empresa.

**Pelo cliente (`/plano`):** com empresas, o cartão diz **Plano do grupo** e *vale para* quais
empresas (as que herdam). As de plano próprio aparecem num quadro à parte (plano e vencimento) com
o aviso de que a troca é pelo suporte — o cliente não muda plano de empresa sozinho. A seção de
planos vira *Mudar o plano do grupo*, com a mesma frase de escopo (vale para X; não muda Y), e
escolher um plano pede confirmação com esse texto antes do checkout (o modal do Asaas repete).

### Painel de vencimentos (`/plano/vencimentos`)

Para quem tem `billing.manage`, a partir de *Plano e uso*. Uma lista só com:

- a **assinatura do cliente** (grupo), com o número de unidades;
- logo abaixo, as **empresas que herdam** (valor = parte delas no grupo; pagam junto com o grupo);
- as **empresas com assinatura própria**.

Colunas: empresa, plano, status (*Em dia*, *A vencer em X dias* — até 7 —, *Atrasado*), valor,
vencimento e ação. Filtros rápidos *A vencer nos próximos 7 dias* e *Inadimplentes*. Cartões no
topo: total a pagar no mês (o que vence até o fim do mês, atrasado incluso), próximo vencimento e
total em atraso. Regras puras em `billing/dues.ts`.

**Pagar / Pagar todos** — `POST /billing/dues/pay {keys}` gera **uma** cobrança avulsa no Asaas
(`billingType: UNDEFINED` = boleto ou PIX) com a soma das linhas escolhidas; o valor é recalculado
na API. A cobrança abre no mesmo modal do PIX (com link do boleto). Detalhes:

- Só entra o que vence até o fim do mês ou nos próximos 7 dias (o que for mais longe) — sem
  isso daria para pagar meses adiantados.
- Grupo com assinatura no **Asaas**: entra a cobrança do ciclo que a própria assinatura gerou;
  ela é **apagada no Asaas** e o valor vai para a consolidada (senão o cliente pagaria duas
  vezes). Se apagar falhar, a consolidada é desfeita. Cobrança do ciclo no cartão não entra
  (é debitada sozinha). Stripe, plano gratuito e personalizado também não entram — a linha diz por quê.
- Grupo **sem gateway** (atribuído pelo dono) e empresas com assinatura própria: pagos aqui.
- Os itens ficam congelados em `invoices.items`; `externalReference = bulk:<tenant>:<uuid>`.
  Uma consolidada nova que cubra linha de outra ainda em aberto cancela a anterior.
- Paga (webhook ou polling do modal): quem vira a fatura para `paid` primeiro baixa os itens —
  cada um volta a `active` e o vencimento anda **um ciclo a partir do vencimento** (não de
  hoje); grupo no Asaas pega a data da assinatura de lá. Webhook repetido não anda de novo.
- Sem cadastro no Asaas e sem CPF/CNPJ no cliente: a API responde `document_required` e o modal pede o documento.

## Fila agrupada por atendente

Na lista de conversas, o botão com ícone de duas pessoas (ao lado de *Aguardando / Atendendo /
Encerrado*) liga o modo agrupado: uma seção recolhível por atendente responsável (com
quantidade e não lidas), em ordem alfabética, e **Sem atendente · Fila** por último. Dentro de
cada seção a ordem é a da lista (o agrupamento separa, não reordena). Desligado, volta à lista
cronológica. A preferência e as seções recolhidas ficam salvas no navegador.

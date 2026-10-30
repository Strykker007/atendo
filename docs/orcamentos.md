# Orçamentos com link seguro

O atendente monta um orçamento/pedido no chat. Dois jeitos de mandar: **Enviar orçamento** (a mensagem com itens e valores vai por texto, o cliente aprova e só então o link sai — ver [Orçamento com aprovação](#orçamento-com-aprovação)) ou **Só o link**, em que o contato recebe **só um link** pelo WhatsApp. Itens, dosagens, valores e chave Pix ficam numa página pública (`/o/:hash`), e o comprovante sobe direto para o storage pela página — sem foto aberta trafegando na conversa.

> **Por quê:** mensagem com lista de medicamento, preço e chave Pix é o tipo de conteúdo que leva número a banimento. Um texto genérico com link, não.

## No chat

Atalho **Orçamento** na linha das abas acima do campo, ao lado de *Mensagem para o cliente* | *Nota interna* (aparece para todos; na conversa de outra pessoa, não). O link sempre entra no campo da **mensagem** — se estava na nota, o composer volta para a mensagem. O modal tem duas abas:

- **Novo orçamento:** itens (nome, dosagem/apresentação — com o encerramento sem venda o rótulo vira "Detalhe", com exemplos genéricos; o campo da API é sempre `dosage` —, quantidade, valor unitário), chave Pix cadastrada (a primeira já vem escolhida) e/ou link de pagamento `https://`, validade (1h, 2h, 4h, 8h, **até o fim do dia** — padrão —, 24h ou 48h; ver [Vencimento](#vencimento)) e observação. Pelo menos uma forma de pagamento é obrigatória.
- **Enviar orçamento** (principal): envia na hora a mensagem formatada com número, itens e total — ver [Orçamento com aprovação](#orçamento-com-aprovação). *Ver prévia da mensagem* mostra o texto antes.
- **Só o link** salva o orçamento e **insere no campo** (não envia):
  > Olá {primeiro nome}, acesse o link para visualizar os detalhes do seu orçamento e opções de pagamento: https://<domínio do painel>/o/<hash>

  O envio segue o caminho normal do chat — quota, janela de 24h da Meta e ledger (`UsageService`) valem igual. O domínio é o que o atendente está usando, então o link sai com a marca certa ([19 — Marcas](19-marcas-e-vertentes.md)).
- **Desta conversa:** orçamentos gerados, com status, "Comprovante recebido", **Ver comprovante** (URL assinada), **Copiar link**, **Inserir no campo** (pendentes) e **Marcar como pago / Desfazer pago**. Atualiza sozinha pelo socket `budgets` quando o comprovante chega.

Não há permissão nem recurso de plano próprio: quem pode abrir a conversa pode gerar orçamento (o `ConversationScopeGuard` barra número/departamento de fora).

## Orçamento por mensagem

**Configurações → Atendimento → Orçamento por mensagem → Permitir enviar o orçamento na mensagem**
(`tenant_settings.budgetQuoteEnabled`). **Desligado é o padrão para todas as empresas** (a
migração `20270127000000_budget_discount_quote` desligou inclusive as que já usavam): o modal só
tem **Gerar link do orçamento** — itens, valores e desconto ficam na página. Ligado, aparecem
**Só o link** e **Enviar orçamento** (com aprovação, abaixo), e a escolha de quando os itens vão no
texto (`budgetQuoteItems`). A API recusa `quote: true` com a opção desligada.

## Desconto

Campo **Desconto** no modal, abaixo do total, em **R$** ou **%** (`budgets.discountValue` em R$;
em %, `discountPercent` guarda o percentual só para mostrar "Desconto (10%)" e o valor sai da soma
dos itens na API; `totalValue` já sai descontado). Migration `20270128000000_budget_discount_percent`. Precisa ser menor que a soma dos itens. Aparece para o cliente em todo lugar: no
texto do orçamento (*Subtotal / 🏷️ Desconto / TOTAL*), na mensagem do link aprovado e da aprovação
em cartão/dinheiro ("já com desconto de R$ X") e na página pública (subtotal e desconto acima do
total). O Pix automático cobra o total com desconto.

## Orçamento com aprovação

> Por padrão os itens **não** vão no texto (`budgetQuoteItems = link`): a mensagem leva número, total e o link — ver [Itens sensíveis](#itens-sensíveis). O texto completo abaixo só sai com a opção ligada.

Para quem prefere mandar o orçamento escrito e só cobrar depois do "ok" do cliente — sem o atendente voltar ao modal.

1. **Enviar orçamento** cria o orçamento com **número sequencial por empresa** (`number`) e `quotedAt`, e envia direto (mesmo envio do campo: assinatura, quota, janela da Meta e ledger) a mensagem `budgetQuoteText` (packages/shared):
   ```
   🧾 *ORÇAMENTO Nº 42*
   Cliente: João
   ━━━━━━━━━━━━━━━
   *1. Dipirona*
        _500 mg, 30 comp._
        2 × R$ 10,00 = R$ 20,00
   ━━━━━━━━━━━━━━━
   *TOTAL: R$ 20,00*
   📅 Válido até 29/10 às 23:59
   📝 observação

   ✅ Para aprovar o orçamento, me informe qual a forma de pagamento
   ```
   Chave Pix e link **nunca** vão nesta mensagem. Se o envio falhar, o orçamento é descartado na hora (não fica no atalho algo que o cliente não viu).
2. Enquanto espera, o link **não cobra**: `/o/:hash` mostra itens e total com "Para aprovar o orçamento, me informe qual a forma de pagamento no WhatsApp" (`awaitingApproval`), sem Pix, link de pagamento nem envio de comprovante (o upload responde 400), e o Pix automático **não** é gerado. A página confere a cada 15 s e vira pagamento quando o atendente libera.
3. **Atalho acima do campo** (`OrcamentosAguardando`): cada orçamento esperando aprovação vira uma linha com número, total, itens, **Pix: enviar link**, **Cartão/dinheiro** e ✕ (descartar). O link só vai quando o cliente paga por Pix; se a resposta fala em cartão, crédito, débito ou dinheiro (e não em Pix), o botão em destaque é **Cartão/dinheiro**. Se a última mensagem do contato fala a forma de pagamento (Pix, cartão, crédito, débito, dinheiro) ou "aprov…", a linha fica verde **Cliente aprovou** — com mais de um orçamento aberto, só a do número que ele citar; sem número, aviso para conferir qual.
4. **Pix: enviar link** pede confirmação repetindo número, total e itens, chama `POST …/budgets/:id/approve` e envia `budgetLinkText`: "✅ João, seu orçamento *Nº 42* foi aprovado. Total: R$ 20,00 — Para pagar, acesse: …". A página `/o/:hash` também mostra "Seu orçamento Nº 42".

5. **Cartão/dinheiro** pede confirmação, chama `POST …/budgets/:id/approve` com `{link: false}` (aprova **sem** gerar o Pix automático — `autoPix` passa a `false`) e envia só a confirmação `budgetApprovedText`: "✅ João, seu orçamento *Nº 42* foi aprovado. Total: R$ 20,00", sem link. Quando receber, o atendente marca como pago em *Desta conversa*. Se o cliente mudar para Pix, o link continua disponível em *Inserir no campo*.

**Por que não erra de orçamento:** a aprovação é sempre por **id** (a linha clicada), nunca "o último"; a mensagem do link repete número e total; e o Pix automático é gerado na aprovação com o `totalValue` daquele orçamento (`externalReference` = id). Aprovar de novo (clique duplo, outra aba) devolve o mesmo orçamento sem segunda cobrança.

**Validade:** vale para o orçamento enquanto espera; **na aprovação recomeça** (mesma opção escolhida, `validity`). Orçamento vencido antes da aprovação não libera link — gerar outro com o preço do dia. Descartar (✕ ou PATCH `EXPIRED`) só vale para quem ainda espera aprovação.

**Se a aprovação falhar** (Asaas recusou, CPF): volta a esperar aprovação e o erro aparece para o atendente. Se o link foi liberado mas o envio falhou, ele fica em *Desta conversa → Inserir no campo* (já com o texto do número).

### Itens sensíveis

Mensagem com nome de remédio, dosagem e preço é o que derruba número ([aviso acima](#orçamentos-com-link-seguro)). Por isso o modal confere os itens e a observação com `budgetRiskTerms` (packages/shared) antes de enviar:

Com a opção *Enviar itens, protegendo os sensíveis*:

- **Nada sensível** → orçamento completo no texto (acima).
- **Algo sensível** → aviso 🔒 no modal com os termos achados, e a mensagem vai **sem os itens** (`budgetQuoteLinkText`):
  ```
  🧾 *ORÇAMENTO Nº 42*
  Cliente: João
  ━━━━━━━━━━━━━━━
  3 itens · *TOTAL: R$ 350,00*
  📅 Válido até 29/10 às 23:59

  🔒 Veja os itens do orçamento: https://…/o/<hash>

  ✅ Para aprovar o orçamento, me informe qual a forma de pagamento
  ```
  O link é o mesmo que depois recebe o pagamento — a aprovação e o "Enviar link" funcionam igual.

O que conta como sensível: quantidade com unidade (`500 mg`, `10 ml`, `5 g`, `ui`), forma farmacêutica e prescrição (comprimido, cápsula, ampola, gotas, xarope, injetável, receita, tarja, controlado, manipulado, medicamento/remédio, genérico) e uma lista de nomes que costumam gerar bloqueio (emagrecedores como Ozempic/Mounjaro, controlados, disfunção erétil, anabolizantes, cannabis). Sem acento e sem diferença de maiúscula. Na dúvida, esconde — o cliente vê tudo no link do mesmo jeito. Ampliar a lista é editar `RISCO_PALAVRAS`.

**Configurável por empresa** — Configurações → Atendimento → *Orçamento por mensagem* (`tenant_settings.budgetQuoteItems`, `settings.manage`):

| Opção | Itens no texto |
|---|---|
| `link` — Não enviar os itens (**padrão**, toda empresa começa assim) | nunca: só número, total e link |
| `protect` — Enviar itens, protegendo os sensíveis | só quando `budgetRiskTerms` não acha nada |
| `always` — Sempre | sempre, inclusive sensíveis (pede confirmação: risco de bloqueio por conta da empresa) |

O modal mostra o aviso e a prévia conforme a opção (`budgetQuoteShowsItems`). **Na migração para a API oficial da Meta**, revisar esta opção com cada cliente de farmácia: a Meta lê o conteúdo e a política de comércio proíbe *oferecer* remédio com receita/controlado — orçamento com preço já conta como oferta. Para esses, `link`.

## Relatórios

Em **Relatórios → Vendas**: o card **Faturamento por origem** divide o faturado do período em *Pix automático (Asaas)*, *Orçamento pago por fora* e *Informada no encerramento* (venda sem orçamento, ou o adicional além dele), com o % de cada; abaixo, **Estornos no período** (quantidade e valor, já fora do faturado). Faturado, ticket médio, conversão, meta e ranking usam a mesma régua de vendas ([Venda](#venda)).

## Relatório de pagamentos

**Relatórios → Pagamentos** (`/relatorios/pagamentos`, botão no topo de Relatórios; `reports.view`). Mora em Relatórios, não no menu: é acompanhamento — orçamento se cria no chat. Quem tem `conversations.view_all` vê a equipe e filtra por atendente; os demais veem só os seus. Números e departamentos fora do escopo do usuário ficam de fora, como nas conversas. Sem `reports.view`, o atendente acompanha os seus pelo atalho Orçamento → *Desta conversa*, pelo selo 💰 Pago e pela nota na conversa.

- **Período** (hoje, 7 dias, este mês ou datas), **forma de pagamento** (Pix automático × por fora), **atendente**, **busca** por cliente/número.
- **Cartões** com o total do período por situação — Pago (com a divisão Pix automático / por fora), Aguardando pagamento, Expirado, Estornado. Clicar filtra a tabela.
- **Tabela**: gerado em, cliente, atendente, itens, valor, forma, situação (com selos *Após o vencimento*, *No encerramento*, *Comprovante* e a hora de pago/estornado/vencimento) e atalhos: comprovante, copiar link, abrir conversa.
- Atualiza sozinha pelo socket `budgets`.

Na **lista de conversas**, o selo **💰 Pago** marca a conversa com pagamento confirmado depois do último encerramento e ainda não encerrada como venda — quem encerrar já sabe que é "Comprou". A confirmação também chega como **nota interna** na conversa e como aviso no painel.

## Página pública `/o/:hash`

Sem login — o `hash` (128 bits aleatórios, base64url de 22 caracteres) é a credencial. Mobile-first, com as cores da marca do domínio, a **logo da empresa** (Configurações → Empresa → Páginas para o cliente; sem ela, a marca do painel — ver [Foto protegida](foto-protegida.md#configuração)) e o nome fantasia do cliente.

- Mostra itens, dosagens, total, validade, observação e o primeiro nome do contato/atendente. Nada além disso do contato.
- **Pendente:** cartão Pix com **Copiar chave Pix** e/ou botão **Pagar agora** (link externo).
- **Pago:** "Pagamento confirmado"; dados de pagamento somem.
- **Expirado:** aviso para pedir um novo; dados de pagamento e envio de comprovante somem.
- **Enviar comprovante:** JPG/PNG/WEBP/PDF até 10 MB. Pode reenviar (vale o último). Aceito em pendente e pago, recusado em expirado.

## Pix automático

Recurso de plano **`pix_payments`** (*Pix automático no orçamento (Asaas)*). O cliente paga um Pix com o valor exato e o orçamento vira **Pago** sozinho — sem comprovante e sem o atendente conferir extrato. O dinheiro cai direto na conta do Asaas da empresa; o sistema só gera a cobrança e escuta o webhook.

**Conectar** (Configurações → Empresa → *Pix automático (Asaas)*, permissão `settings.manage`): a empresa cola a chave de API do Asaas (Integrações → Chaves de API) e marca *sandbox* se for conta de testes. Ao conectar, a API:
1. valida a chave (`GET /myAccount/commercialInfo`) e guarda o nome da conta;
2. cadastra na conta dela o webhook `POST {API_PUBLIC_URL}/webhooks/pix/asaas/:gatewayId` (eventos `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED`) com um `authToken` aleatório;
3. grava `payment_gateways` com a chave **criptografada** (`CryptoService.encryptJson`).

Trocar a chave recria o webhook; desconectar remove o webhook da conta (se a chave ainda valer) e apaga a conexão.

**No orçamento:** com plano + conta conectada, o modal mostra *Pix automático* já ligado (chave manual e link somem) e o campo **CPF / CNPJ do cliente** — o Asaas exige. Vem preenchido da ficha do contato (`contacts.document`); digitado ou alterado no modal, a API grava na ficha junto com o orçamento (mini cadastro). Também dá para preencher direto na ficha (campo CPF / CNPJ, permissão `contacts.edit`).

**Ao gerar o link**, a API já cria a cobrança: acha/cria o cliente no Asaas pelo documento (sem notificações do Asaas), cria a cobrança `PIX` com o total, vencimento no dia em que o link expira (Brasília) e `externalReference` = id do orçamento, e guarda QR + copia e cola. Se o Asaas recusar (CPF inválido, conta bloqueada…), o orçamento não é criado e o erro aparece **para o atendente** corrigir.

**Na página:** o cliente abre e já vê o QR e **Copiar código Pix** com o valor exato — não digita nada. A página confere a cada 5 s e mostra "Pagamento confirmado"; o envio de comprovante não aparece.

**Baixa:** o webhook confere o `asaas-access-token` com o segredo da conexão, acha o orçamento pelo id da cobrança e marca `PAID` com `paidVia = asaas` (vale mesmo depois de vencido). O painel recebe o socket `budgets` com `paid` e mostra "Pix recebido: R$ … — contato" em qualquer tela; na lista, *Baixa automática*. Responde sempre 200 (o Asaas pausa a fila depois de falhas seguidas); token errado é só registrado no log.

## Venda

Pagamento confirmado — webhook do Asaas (Pix automático) ou **Marcar como pago** (por fora) — **vira venda na hora**: linha em `sales` (`budgetId`) para o **atendente que gerou o orçamento**, na data do pagamento, com os itens. Conta na meta, no ranking e no faturamento mesmo que ninguém encerre a conversa. Uma nota interna aparece na conversa ("💰 Pagamento confirmado…") e o painel avisa.

Para não haver furo nem duplicidade, o encerramento **absorve** o pagamento (`budgets.closeEventId`):

- **Comprou** com orçamento pago no atendimento (pago depois do encerramento anterior): o modal já abre em "Comprou" mostrando o valor pago; o que o atendente digita é o que vendeu **a mais** (opcional). O encerramento grava o total (pago + adicional) e só o adicional vira venda nova. Meta e ranking contam o encerramento, não os dois.
- **Não comprou** com pagamento confirmado: recusado (`400 budget_paid`) — o botão fica desabilitado. Fluxo que encerra como perda vira venda, com aviso para a equipe.
- **Em massa**: conversas com pagamento ficam abertas (`withPayment` na resposta) — encerrar uma a uma.
- **Sem encerramento** (ou encerrada pela automação): o pagamento segue contando sozinho.

**Estorno**: botão **Estornar** na lista do orçamento (gestão — `settings.manage`). Pix automático pede a devolução ao Asaas (`POST /payments/:id/refund`); por fora, só registra. Também chega pelo webhook (`PAYMENT_REFUNDED`). O orçamento vira `REFUNDED`, a venda ganha `refundedAt` e sai do faturamento, da meta e do ranking (se já estava num encerramento, desconta do valor dele). Estorno parcial ou em andamento só gera nota na conversa — conferir no Asaas. **Desfazer pago** existe só para corrigir clique errado no pago por fora ainda não encerrado; o resto é estorno. Os webhooks já cadastrados são alinhados à lista de eventos (pagamento + estorno) quando a API sobe.

## Vencimento

Status: `PENDING` → `PAID` (pago) / `EXPIRED` (venceu sem pagamento) / `REFUNDED` (estornado, ver [Venda](#venda)).

**Validade** (`validity`, `BUDGET_VALIDITY` no shared): 1h, 2h, 4h, 8h, **até o fim do dia** (padrão: 23:59:59 no fuso da empresa), 24h ou 48h. Nunca menos de 30 min — gerado às 23:50 com "fim do dia" vai até 00:20. A API ainda aceita `validHours` (1–720). No Pix automático, o vencimento da cobrança no Asaas é o dia do `expiresAt`, no fuso da empresa.

**Política — dinheiro recebido sempre vale.** Pagamento confirmado pelo Asaas nunca é ignorado, nem depois do vencimento nem com a cobrança cancelada: vira venda (com nota "⚠️ Pago após o vencimento — confira se o pedido ainda vale" e o selo **Pago após o vencimento** na lista). Estornar é decisão da gestão, nunca automática.

| Momento | O que acontece |
|---|---|
| Antes do vencimento | Página com o Pix; na última hora, contagem regressiva ("Vence às 18:00 · faltam 4 min") |
| **No vencimento** | A página some com o Pix na hora (relógio do navegador, sem esperar o servidor); a API passa a responder `EXPIRED` sem `pix`/`pixCharge`/`paymentUrl` |
| Vencimento **+ 10 min** (`BUDGET_GRACE_MINUTES`) | Job cancela a cobrança no Asaas (`DELETE /payments/:id`, `gatewayCancelledAt`) — quem colou o código antes do vencimento teve a tolerância para o banco processar |
| Cancelamento recusado | Consulta a cobrança: paga (o "10 segundos antes") → registra a venda na hora; senão, tenta de novo na rodada seguinte |
| A cada 5 min | Conferência: Pix automáticos das últimas 48 h ainda sem pagamento são consultados no Asaas — paga sem webhook (API fora, rede) vira venda |

**Data da venda** = dia do pagamento no Asaas (`clientPaymentDate`/`paymentDate`, sem hora): aviso que chega no dia seguinte grava 23:59:59 do dia pago, no fuso da empresa — conta no dia e no mês certos da meta.

**Job** `budgets` (BullMQ, a cada 1 min, `BudgetsService.processarVencimentos`, roda na API): `PENDING` vencido → `EXPIRED`; cancelamento após a tolerância (até 50 por rodada); conferência a cada 5 min (até 200). Cancelar, conferir e estornar usam a conta conectada **sem olhar o plano** (`accountOf`): perder o recurso não deixa QR vivo nem venda sem registro. Conta desconectada: não cancela (cancelar pelo painel do Asaas); o webhook continua valendo enquanto existir.

Pago por fora pode ser marcado depois do vencimento (o cliente pagou no prazo e avisou tarde).

A chave Pix é **copiada** para o orçamento na geração: editar ou apagar a chave depois não muda orçamentos já enviados.

## API

| Método | Rota | Quem | O quê |
|---|---|---|---|
| GET | `/conversations/:id/budgets` | todos (escopo da conversa) | Últimos 30 orçamentos da conversa, com `receipt.url` assinada |
| POST | `/conversations/:id/budgets` | todos (escopo da conversa) | `{items: {name, dosage?, quantity, unitPrice}[] (1–50), pixKeyId?, paymentUrl? (https), note?, quote? (orçamento por texto, espera aprovação), validity? (1h\|2h\|4h\|8h\|end_of_day\|24h\|48h; padrão end_of_day), validHours? (1–720), autoPix?, cpfCnpj?}`. Sem Pix e sem link = 400 (exceto `autoPix`). `autoPix` gera a cobrança no Asaas na hora; sem CPF/CNPJ (do body ou da ficha) = 400; `cpfCnpj` informado vai para a ficha |
| PATCH | `/conversations/:id/budgets/:budgetId` | todos (escopo da conversa) | `{status: 'PAID' \| 'PENDING' \| 'EXPIRED'}` — PAID cria a venda; PENDING desfaz só o pago por fora ainda não encerrado; EXPIRED descarta orçamento que ainda espera aprovação. Socket `budgets` |
| POST | `/conversations/:id/budgets/:budgetId/approve` | todos (escopo da conversa) | Cliente aprovou o orçamento por texto: `approvedAt`, validade recomeça, gera o Pix automático. Idempotente. 400 se vencido/pago; 409 se o Pix ainda está sendo gerado |
| POST | `/conversations/:id/budgets/:budgetId/refund` | `settings.manage` | Estorno (Asaas devolve no Pix automático) — ver [Venda](#venda) |
| GET | `/budgets?from=&to=&status=&via=auto\|fora&userId=&search=&page=` | `reports.view` (os seus; `conversations.view_all` = equipe) | Relatórios → Pagamentos: `{page, pageSize (30), total, totals{byStatus{STATUS:{count,value}}, paidByVia{asaas,manual}}, rows[…, conversationId, contact, paidAfterExpiry]}` — os totais ignoram o filtro de `status` |
| GET | `/budgets/public/:hash` | público (30/min por IP) | `PublicBudget` (packages/shared) |
| POST | `/budgets/public/:hash/receipt` | público (5/min por IP) | multipart `file`. Socket `budgets` |
| POST | `/webhooks/pix/asaas/:gatewayId` | Asaas (header `asaas-access-token`) | Baixa automática. Sempre 200 |
| GET | `/tenants/me/payment-gateway` | todos | `{feature, connected, provider?, sandbox?, accountName?, connectedAt?}` |
| PUT | `/tenants/me/payment-gateway` | `settings.manage` + `pix_payments` | `{apiKey, sandbox?}` — valida, cadastra o webhook, grava criptografado |
| DELETE | `/tenants/me/payment-gateway` | `settings.manage` | Remove o webhook da conta e desconecta |

Código: `apps/api/src/modules/budgets/budgets.module.ts`, `apps/web/src/components/chat/BudgetModal.tsx`, `apps/web/src/app/o/[hash]/page.tsx`, tipos em `packages/shared/src/budgets.ts`.

## Modelo

`budgets` ([06 — Modelo de dados](06-modelo-de-dados.md)): `tenantId`, `conversationId`, `contactId`, `userId` (atendente), `hash` (único), `items` (jsonb), `totalValue` (decimal 12,2, soma em centavos), cópia da chave Pix (`pixKey`, `pixKeyType`, `pixHolderName`), `paymentUrl`, `note`, `status`, `expiresAt`, comprovante (`receiptKey` no storage, `receiptMime`, `receiptName`, `receiptAt`), `paidAt`, `paidById`, `paidVia` (`manual` | `asaas`), Pix automático (`autoPix`, `gatewayPaymentId` único, `pixPayload`, `pixQrImage`), aprovação (`number` — único por empresa, nulo nos antigos —, `quotedAt`, `approvedAt`, `approvedById`, `validity`). `payment_gateways`: uma conta por empresa (`provider` = asaas, `credentials` criptografado, `sandbox`, `webhookToken`, `webhookId`, `accountName`). Migrações `20261202000000_budgets`, `20261203000000_pix_gateway`, `20261203000100_contact_document` (`contacts.document`), `20261205000000_budget_sale_refund` `20261206000000_budget_gateway_cancel` (`gatewayCancelledAt`) e `20270119000000_budget_quote` (aprovação; só colunas opcionais).

## Limites atuais

- Comprovante chegando só atualiza a lista do modal (socket); não gera aviso/notificação nem evento na linha do tempo.
- Arquivo de comprovante substituído continua no storage (o storage não apaga).
- Sem Pix automático, o status pago é manual. Com ele, só o Asaas; outros gateways (Mercado Pago, Efí) seriam novos `provider`.
- Pago pelo Pix automático não registra venda nem encerra o atendimento sozinho.

# Orçamentos com link seguro

O atendente monta um orçamento/pedido no chat e o contato recebe **só um link** pelo WhatsApp. Itens, dosagens, valores e chave Pix ficam numa página pública (`/o/:hash`), e o comprovante sobe direto para o storage pela página — sem foto aberta trafegando na conversa.

> **Por quê:** mensagem com lista de medicamento, preço e chave Pix é o tipo de conteúdo que leva número a banimento. Um texto genérico com link, não.

## No chat

Barra do campo de mensagem → ícone de recibo (**Gerar orçamento / pedido**). O modal tem duas abas:

- **Novo orçamento:** itens (nome, dosagem/apresentação, quantidade, valor unitário), chave Pix cadastrada (a primeira já vem escolhida) e/ou link de pagamento `https://`, validade (24h, **48h** padrão, 3 ou 7 dias) e observação. Pelo menos uma forma de pagamento é obrigatória.
- **Gerar link** salva o orçamento e **insere no campo** (não envia):
  > Olá {primeiro nome}, acesse o link para visualizar os detalhes do seu orçamento e opções de pagamento: https://<domínio do painel>/o/<hash>

  O envio segue o caminho normal do chat — quota, janela de 24h da Meta e ledger (`UsageService`) valem igual. O domínio é o que o atendente está usando, então o link sai com a marca certa ([19 — Marcas](19-marcas-e-vertentes.md)).
- **Desta conversa:** orçamentos gerados, com status, "Comprovante recebido", **Ver comprovante** (URL assinada), **Copiar link**, **Inserir no campo** (pendentes) e **Marcar como pago / Desfazer pago**. Atualiza sozinha pelo socket `budgets` quando o comprovante chega.

Não há permissão nem recurso de plano próprio: quem pode abrir a conversa pode gerar orçamento (o `ConversationScopeGuard` barra número/departamento de fora).

## Página pública `/o/:hash`

Sem login — o `hash` (128 bits aleatórios, base64url de 22 caracteres) é a credencial. Mobile-first, com a logo/cores da marca do domínio e o nome fantasia do cliente.

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

## Status e expiração

`PENDING` → `PAID` (atendente marca) ou `EXPIRED` (passou do `expiresAt`). Não há job: o vencimento é aplicado na leitura — a página pública grava `EXPIRED` ao abrir, e o painel mostra como expirado mesmo antes disso. Pago vale mesmo depois de vencido; desfazer o pago de um vencido volta a `EXPIRED`.

A chave Pix é **copiada** para o orçamento na geração: editar ou apagar a chave depois não muda orçamentos já enviados.

## API

| Método | Rota | Quem | O quê |
|---|---|---|---|
| GET | `/conversations/:id/budgets` | todos (escopo da conversa) | Últimos 30 orçamentos da conversa, com `receipt.url` assinada |
| POST | `/conversations/:id/budgets` | todos (escopo da conversa) | `{items: {name, dosage?, quantity, unitPrice}[] (1–50), pixKeyId?, paymentUrl? (https), note?, validHours? (1–720, padrão 48), autoPix?, cpfCnpj?}`. Sem Pix e sem link = 400 (exceto `autoPix`). `autoPix` gera a cobrança no Asaas na hora; sem CPF/CNPJ (do body ou da ficha) = 400; `cpfCnpj` informado vai para a ficha |
| PATCH | `/conversations/:id/budgets/:budgetId` | todos (escopo da conversa) | `{status: 'PAID' \| 'PENDING'}`. Socket `budgets` |
| GET | `/budgets/public/:hash` | público (30/min por IP) | `PublicBudget` (packages/shared) |
| POST | `/budgets/public/:hash/receipt` | público (5/min por IP) | multipart `file`. Socket `budgets` |
| POST | `/webhooks/pix/asaas/:gatewayId` | Asaas (header `asaas-access-token`) | Baixa automática. Sempre 200 |
| GET | `/tenants/me/payment-gateway` | todos | `{feature, connected, provider?, sandbox?, accountName?, connectedAt?}` |
| PUT | `/tenants/me/payment-gateway` | `settings.manage` + `pix_payments` | `{apiKey, sandbox?}` — valida, cadastra o webhook, grava criptografado |
| DELETE | `/tenants/me/payment-gateway` | `settings.manage` | Remove o webhook da conta e desconecta |

Código: `apps/api/src/modules/budgets/budgets.module.ts`, `apps/web/src/components/chat/BudgetModal.tsx`, `apps/web/src/app/o/[hash]/page.tsx`, tipos em `packages/shared/src/budgets.ts`.

## Modelo

`budgets` ([06 — Modelo de dados](06-modelo-de-dados.md)): `tenantId`, `conversationId`, `contactId`, `userId` (atendente), `hash` (único), `items` (jsonb), `totalValue` (decimal 12,2, soma em centavos), cópia da chave Pix (`pixKey`, `pixKeyType`, `pixHolderName`), `paymentUrl`, `note`, `status`, `expiresAt`, comprovante (`receiptKey` no storage, `receiptMime`, `receiptName`, `receiptAt`), `paidAt`, `paidById`, `paidVia` (`manual` | `asaas`), Pix automático (`autoPix`, `gatewayPaymentId` único, `pixPayload`, `pixQrImage`). `payment_gateways`: uma conta por empresa (`provider` = asaas, `credentials` criptografado, `sandbox`, `webhookToken`, `webhookId`, `accountName`). Migrações `20261202000000_budgets`, `20261203000000_pix_gateway` e `20261203000100_contact_document` (`contacts.document`).

## Limites atuais

- Comprovante chegando só atualiza a lista do modal (socket); não gera aviso/notificação nem evento na linha do tempo.
- Arquivo de comprovante substituído continua no storage (o storage não apaga).
- Sem Pix automático, o status pago é manual. Com ele, só o Asaas; outros gateways (Mercado Pago, Efí) seriam novos `provider`.
- Pago pelo Pix automático não registra venda nem encerra o atendimento sozinho.

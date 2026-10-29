# Contatos isentos ("não gera relatório")

Lista, por cliente, de telefones cujos atendimentos **não entram em relatório**: diretoria,
fornecedores, o celular da própria loja. A conversa segue o **atendimento normal** — Aguardando →
Atendendo (com dono) → Encerrado —, mas fica fora de todo relatório de desempenho, não aciona
automação nem pesquisa e encerra sem resultado. Na tela aparece com o selo **Sem relatório**.

Até 27/10/2026 o isento virava "chat livre" (sempre aberto, sem dono, fora da fila). Mudou a pedido
do cliente: "se o número está aguardando atendimento e é marcado como não gera relatório, ele não pode
mudar de status ou fila por ser marcado — aguardando continua aguardando até que comecem a atender".
**Chat livre** (aberto, sem dono, fora da fila) ficou só para **grupo** ([Grupos](grupos.md)) e para as
conversas isentas marcadas antes da mudança que ainda estão abertas sem dono (`LIVRE` na API,
`isFreeChat` no front).

## Regras

| Regra | Onde |
|---|---|
| Na entrada (`InboundService.ingestInbound`), o telefone do remetente é conferido na lista **com e sem o nono dígito** (`phoneVariants`) | `ignored-contacts/ignored-contacts.ts` (`isTicketExempt`) |
| **Números da própria conta** são isentos automaticamente, sem cadastro: quando um número conectado da loja escreve para outro (`whatsapp_numbers` do tenant, não excluído, com e sem o nono dígito), é a equipe conversando — sem isto o robô de um responderia o outro, em pingue-pongue | `isTicketExempt` |
| Isento: a conversa nasce/fica `ticketExempt = true` e segue a regra comum de status — nasce em **Aguardando**, reabre ao voltar a falar depois de encerrada, marca espera (`awaitingSince`), tem dono ao assumir/responder | `inbound.service.ts` |
| Sem automação: a entrada volta como `quiet`, então o processor não dispara fluxo, boas-vindas, horário ou agenda; pesquisa de satisfação não é reivindicada | `inbound.service.ts` / `inbound.processor.ts` |
| Continua passando pelo ledger (`UsageService.record`) — é tráfego real e é cobrado como qualquer mensagem | `inbound.service.ts` |
| Responder pelo painel **assume** como qualquer atendimento (só a conversa livre — grupo — não assume) | `ConversationsService.send` (`ehLivre`) |
| Encerrar: **sem resultado** (`outcome = none`), sem venda, sem pesquisa e sem o fluxo padrão de encerramento (só o escolhido explicitamente); o evento `closed` sai com `ignoreInReports = true`. Não exige `conversations.close_internal` — a marca já foi decidida por quem tem `settings.manage`. O aviso de encerramento (Configurações → Encerramento), se ligado, sai normalmente. Em massa: entra com o resultado escolhido, mas o evento também vai com `ignoreInReports` | `conversations.controller.ts` (`status`) / `ConversationsService.setStatus` / `closeMany` |
| Abas e contadores: isento aparece e conta em Aguardando/Atendendo/Encerrado como qualquer conversa (regra de posse inclusa). **Atendendo** mostra também as conversas livres (grupo; isentas antigas sem dono), com o selo **Livre**; a visão **Conversas livres** (`GET /conversations?free=1`) lista todos os isentos e livres, em qualquer status | `ConversationsService.list` (`LIVRE`, `comLivres`) / `counts` |
| Relatórios: conversa `ticketExempt` sai de **todas** as métricas — volume, TMA/TMR (1ª resposta), encerramentos, perdidos, ranking, auditoria de atendimentos, mensagens enviadas/recebidas, comparativo por empresa. Vendas registradas (`sales`) continuam contando: é dinheiro que entrou | `reports.module.ts` (`not c."ticketExempt"`, `semIsento`) |

### Entrar e sair da lista

- **Entrou**: as conversas que já existem com aquele telefone só ganham `ticketExempt = true`.
  **Status, dono e espera não mudam** — aguardando continua aguardando; quem estava atendendo
  continua. O painel recebe o evento `conversation`.
- **Saiu**: só tira a marca. A conversa livre de antes (aberta sem dono, que ninguém via na aba)
  volta para **Aguardando**.
- A entrada confere a lista a cada mensagem, então uma lista mexida por fora (banco) se acerta
  sozinha na próxima mensagem (`aplicarIsencao`, com a mesma regra).

## Tela

**Configurações → Atendimento → Contatos isentos de ticket** (`/configuracoes/contatos-isentos`).
Adicionar por telefone digitado (com DDI) ou buscando um contato existente e clicando na linha dele (a linha inteira isenta); remover pela lixeira.
Exige `settings.manage`.

**Atalhos** (mesma permissão; grupo não tem, porque é sempre livre), com confirmação (`components/chat/ExemptConfirm.tsx`):
- **Menu do card** na lista de conversas (clique direito ou ⋮): *Não gerar relatório* / *Voltar a gerar relatório*.
- **Cabeçalho da conversa aberta**: botão *Não gerar relatório* (sino cortado); na conversa isenta, o selo **Sem relatório** (ao lado do status) é clicável e oferece voltar a gerar relatório.

Na lista, o card do isento tem o status normal e o selo **Sem relatório**; a conversa livre tem a
faixa cinza e o selo **Livre**. O botão **Conversas livres (sem ticket)** fica dentro dos filtros
(ícone de ajustes), com o contador, e só aparece quando o cliente tem alguma.

Na conversa aberta, **Encerrar** abre uma confirmação curta (`CloseModal` → `ExemptCloseModal`): sem
resultado, sem pesquisa, fora dos relatórios. Na conversa livre (grupo) não há Encerrar.

## Dados

- `ignored_contacts` — `{tenantId, phone (só dígitos), label, createdById, createdAt}`, único por `(tenantId, phone)`.
- `conversations.ticketExempt` — índice `(tenantId, ticketExempt, lastMessageAt desc)` para a visão Conversas livres.

Migração: `20261230000000_ignored_contacts_internal_chat`. A mudança de 27/10/2026 não tem migration:
as isentas antigas abertas sem dono continuam livres até a próxima mensagem do contato (aí voltam para
Aguardando) ou até alguém **Assumir** (responder sem assumir não muda, como no grupo).

## API

| Método | Rota | Permissão | O quê |
|---|---|---|---|
| GET | `/ignored-contacts` | `settings.manage` | Lista, mais novos primeiro, com o contato do painel (`contact`) quando o telefone já existe |
| POST | `/ignored-contacts` | `settings.manage` | `{phone}` ou `{contactId}`, `label?`. 409 se o telefone (com/sem nono dígito) já está |
| DELETE | `/ignored-contacts/:id` | `settings.manage` | Tira da lista (só a marca; a livre antiga volta para Aguardando) |
| DELETE | `/ignored-contacts/contact/:contactId` | `settings.manage` | O mesmo, pelo contato (atalho da conversa). 404 se não está na lista; 409 se é número da própria conta (isento sem cadastro) |
| GET | `/conversations?free=1` | (escopo normal da lista) | Visão Conversas livres. `/conversations/counts` devolve `free` |

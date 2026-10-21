# Contatos isentos de ticket

Lista, por cliente, de telefones que **nunca abrem atendimento**: diretoria, fornecedores, o
celular da própria loja. A mensagem continua chegando e pode ser respondida, mas vira **chat
livre**: fica em **Conversas livres** (nos filtros da tela de conversas), fora das filas e de todo relatório de desempenho.

## Regras

| Regra | Onde |
|---|---|
| Na entrada (`InboundService.ingestInbound`), o telefone do remetente é conferido na lista **com e sem o nono dígito** (`phoneVariants`) | `ignored-contacts/ignored-contacts.ts` (`isTicketExempt`) |
| **Números da própria conta** são isentos automaticamente, sem cadastro: quando um número conectado da loja escreve para outro (`whatsapp_numbers` do tenant, não excluído, com e sem o nono dígito), é a equipe conversando — sem isto o robô de um responderia o outro, em pingue-pongue | `isTicketExempt` |
| Isento: a conversa nasce/fica `ticketExempt = true`, `status = in_progress`, **sem dono** e sem `awaitingSince`. Não reabre atendimento (nada de `setStatusSystem`, nada de evento `reopened`), não cai na fila, não roda pesquisa de satisfação | `inbound.service.ts` |
| Sem automação: a entrada volta como `quiet`, então o processor não dispara fluxo, boas-vindas, horário ou agenda | `inbound.processor.ts` (já respeitava `quiet`) |
| Mensagem digitada no celular (`fromMe`) para um isento também não reabre atendimento | `InboundService.ingestFromDevice` |
| Continua passando pelo ledger (`UsageService.record`) — é tráfego real e é cobrado como qualquer mensagem | `inbound.service.ts` |
| Responder pelo painel **não assume** a conversa (conversa livre não tem dono; qualquer um da equipe responde). Quota e janela de 24h da Meta valem igual | `ConversationsService.send` |
| As abas Aguardando/Atendendo/Encerrado e seus contadores **nunca** mostram conversa livre; a visão **Conversas livres** (`GET /conversations?free=1`) mostra só elas, em qualquer status | `ConversationsService.list` / `counts` (`free`) |
| Relatórios: conversa `ticketExempt` sai de **todas** as métricas — volume, TMA/TMR (1ª resposta), encerramentos, perdidos, ranking, auditoria de atendimentos, mensagens enviadas/recebidas, comparativo por empresa. Vendas registradas (`sales`) continuam contando: é dinheiro que entrou | `reports.module.ts` (`not c."ticketExempt"`, `semIsento`) |

### Entrar e sair da lista

- **Entrou**: as conversas que já existem com aquele telefone viram livres na hora
  (`ticketExempt = true`, `in_progress`, sem dono, sem espera) e o painel recebe o evento `conversation`.
- **Saiu**: a conversa livre é guardada como encerrada (`closed`, sem evento de encerramento — não
  foi atendimento). A próxima mensagem do contato abre ticket normalmente.
- A entrada confere a lista a cada mensagem, então uma lista mexida por fora (banco) se acerta
  sozinha na próxima mensagem (`aplicarIsencao`).

## Tela

**Configurações → Atendimento → Contatos isentos de ticket** (`/configuracoes/contatos-isentos`).
Adicionar por telefone digitado (com DDI) ou buscando um contato existente e clicando na linha dele (a linha inteira isenta); remover pela lixeira.
Exige `settings.manage`.

Na lista de conversas, **não é aba**: ficava como 4ª aba ao lado de Aguardando/Atendendo/Encerrado,
espremia as quatro na coluna de 320px e não dizia o que era. Agora é o botão **Conversas livres (sem
ticket)** dentro dos filtros (ícone de ajustes), com o contador, e só aparece quando o cliente tem
alguma. Aberta, conta como filtro ligado (número no ícone) e mostra a faixa "Conversas livres ·
contatos isentos de ticket — Voltar à fila"; *Limpar filtros* também volta para a fila.

Na conversa aberta, o selo **Livre · sem ticket** substitui o status e o botão **Encerrar** some.

## Dados

- `ignored_contacts` — `{tenantId, phone (só dígitos), label, createdById, createdAt}`, único por `(tenantId, phone)`.
- `conversations.ticketExempt` — índice `(tenantId, ticketExempt, lastMessageAt desc)` para a visão Conversas livres.

Migração: `20261230000000_ignored_contacts_internal_chat`.

## API

| Método | Rota | Permissão | O quê |
|---|---|---|---|
| GET | `/ignored-contacts` | `settings.manage` | Lista, mais novos primeiro, com o contato do painel (`contact`) quando o telefone já existe |
| POST | `/ignored-contacts` | `settings.manage` | `{phone}` ou `{contactId}`, `label?`. 409 se o telefone (com/sem nono dígito) já está |
| DELETE | `/ignored-contacts/:id` | `settings.manage` | Tira da lista e devolve as conversas ao fluxo normal |
| GET | `/conversations?free=1` | (escopo normal da lista) | Visão Conversas livres. `/conversations/counts` devolve `free` |

# 01 — Visão geral

## O que é

O Atendo é um SaaS de atendimento ao cliente via WhatsApp. Você (dono do Atendo) vende o sistema para empresas (**clientes**, chamados no código de **tenants**). Cada cliente conecta um ou mais **números** de WhatsApp e a equipe dele responde as mensagens pelo painel web, com fila de atendimento, tags, respostas rápidas e relatórios.

## Papéis (roles)

| Role | Quem é | O que pode |
|---|---|---|
| `super_admin` | Você, dono do Atendo | **Financeiro** consolidado, **Clientes** (criar, plano, status, ativar/desativar) e **Entrar como** qualquer cliente para ver o sistema como o admin dele. Não tem área de cliente própria |
| `tenant_admin` | Administrador do cliente | Tudo do gerente + números, plano/cobrança, criar gerentes |
| `manager` | Gerente | Vê todas as conversas, transfere, orienta por **nota interna** (cadeado), gerencia tags, respostas rápidas e atendentes |
| `agent` | Atendente do cliente | Atende as próprias conversas, aplica tags, usa respostas rápidas |

Cada usuário pertence a um único tenant (exceto `super_admin`, que não pertence a nenhum).

**Quem vê o quê no financeiro:** o admin do cliente vê só o *Plano e uso* dele (consumo, faturas, planos). O Financeiro consolidado (MRR, margem, todos os clientes) é exclusivo do dono. Quando o dono "entra como" um cliente, vê exatamente o que o admin daquele cliente vê — com uma faixa no topo indicando isso e o botão *Sair do cliente*. **Tudo** que um usuário vê é filtrado pelo `tenantId` do token dele — nunca por parâmetro da requisição.

## Conceitos e como se relacionam

```
Tenant (cliente)
 ├── Plano/assinatura ── limites (números, atendentes, mensagens/mês)
 ├── Usuários (admin + atendentes)
 ├── Números de WhatsApp ── cada um com um provider (meta | evolution)
 │     └── Conversas ── cada uma com um Contato, um status e N tags
 │           └── Mensagens (in / out)
 ├── Tags (criadas pelo cliente, viram filtros e relatórios)
 ├── Pastas de respostas rápidas ── respostas
 └── Uso (ledger de mensagens) ── contadores mensais ── faturas
```

## Ciclo de uma conversa

1. O contato manda mensagem para um número do cliente.
2. O provider (Meta ou Evolution) chama o webhook do Atendo.
3. O Atendo cria/atualiza o contato, abre uma conversa em **Aguardando atendimento** (ou reaproveita a que já está aberta) e grava a mensagem.
4. Um atendente abre a conversa e responde → status vira **Em atendimento** e a conversa fica atribuída a ele.
5. Ao terminar, o atendente clica em **Encerrar**. Nova mensagem do mesmo contato abre uma **nova** conversa (assim os relatórios contam atendimentos, não contatos).

## Um número, várias atendentes — posse do atendimento

O número é do **cliente**, não de um usuário: todas as atendentes do cliente veem o mesmo número sem "conectar de novo". O que separa quem atende quem é a **posse** da conversa:

| Momento | Quem vê | Quem pode responder |
|---|---|---|
| Contato manda mensagem → *Aguardando* | todas | qualquer uma — a primeira que responder (ou clicar **Assumir**) vira dona |
| Marta assumiu → *Em atendimento* | Marta (em "Minhas"); admin (em "Todos") | Marta; admin também (sem tomar a posse) |
| Maria abre a mesma conversa | vê o histórico, mas o composer avisa "Marta está atendendo" | não |
| Marta **transfere** para Maria | some para Marta, aparece para Maria | Maria |
| Marta **devolve à fila** | volta para *Aguardando* de todas | qualquer uma |
| Encerrada | todas | ninguém (reabrir = quem reabriu assume) |

### O cadeado (nota interna)

Gerente/admin **não responde ao cliente** numa conversa que é de uma atendente — para isso transfere para si. O que ele tem é o **cadeado** na barra de mensagem:

- Fechado (padrão): não envia nada.
- Aberto: o campo vira âmbar "Nota interna para Maria — o cliente não vê". A nota entra no histórico com destaque (borda âmbar, "Nota interna · Gil · só a equipe vê"), chega na hora para a atendente, **nunca vai ao WhatsApp** e não conta no uso do plano.
- Fechou o cadeado: volta a não enviar. O cadeado reseta ao trocar de conversa.

Se duas clicarem em *Assumir* ao mesmo tempo, o banco garante que só uma ganha; a outra recebe "Marta já assumiu este atendimento" (ver [03 › Posse atômica](03-arquitetura.md#posse-do-atendimento)).

## Os três filtros principais

Sempre visíveis acima da lista: **Aguardando · Em atendimento · Encerrado**. São o status da conversa. Abaixo deles ficam os filtros secundários: número, busca por contato e tags.

## Tags

Criadas dinamicamente pelo admin do cliente em *Tags* (ex.: "lead com interesse", "comprador recorrente"). O atendente aplica no cabeçalho do chat. Elas alimentam:

- o filtro da lista de conversas;
- os relatórios (ex.: "conversas por tag por semana").

## Respostas rápidas

Painel à direita do chat, organizado em pastas ("sessões"). Clicar numa resposta insere o texto no campo de digitação. Suporta variáveis `{{contact.name}}` e `{{agent.name}}` (substituição no front — ainda a implementar).

## Fluxos de automação

O cliente desenha o atendimento automático (menus, perguntas, condições) e dispara pelo chat ou automaticamente. Detalhes em [10 — Fluxos](10-fluxos-de-automacao.md). É uma funcionalidade **do plano** (Pro e Business).

## Oficial vs. não-oficial

Cada número escolhe **como** fala com o WhatsApp:

- **Oficial (Meta Cloud API)** — número de negócio, sem risco de banimento, custa por template enviado.
- **Não-oficial (Evolution API)** — qualquer número, conecta por QR code, grátis, mas viola os termos da Meta e pode ser banido.

A troca é um clique em *Números → Trocar provider*. Detalhes em [04 — Providers](04-providers-whatsapp.md).

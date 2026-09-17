# 01 — Visão geral

## O que é

O Atendo é um SaaS de atendimento ao cliente via WhatsApp. Você (dono do Atendo) vende o sistema para empresas (**clientes**, chamados no código de **tenants**). Cada cliente conecta um ou mais **números** de WhatsApp e a equipe dele responde as mensagens pelo painel web, com fila de atendimento, tags, respostas rápidas e relatórios.

## Papéis (roles)

| Role | Quem é | O que pode |
|---|---|---|
| `super_admin` | Você, dono do Atendo | Criar clientes, definir planos, ver margem de todos |
| `tenant_admin` | Administrador do cliente | Gerenciar números, atendentes, tags, respostas rápidas, ver uso do plano |
| `agent` | Atendente do cliente | Atender conversas, aplicar tags, usar respostas rápidas |

Cada usuário pertence a um único tenant (exceto `super_admin`, que não pertence a nenhum). **Tudo** que um usuário vê é filtrado pelo `tenantId` do token dele — nunca por parâmetro da requisição.

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

## Os três filtros principais

Sempre visíveis acima da lista: **Aguardando · Em atendimento · Encerrado**. São o status da conversa. Abaixo deles ficam os filtros secundários: número, busca por contato e tags.

## Tags

Criadas dinamicamente pelo admin do cliente em *Tags* (ex.: "lead com interesse", "comprador recorrente"). O atendente aplica no cabeçalho do chat. Elas alimentam:

- o filtro da lista de conversas;
- os relatórios (ex.: "conversas por tag por semana").

## Respostas rápidas

Painel à direita do chat, organizado em pastas ("sessões"). Clicar numa resposta insere o texto no campo de digitação. Suporta variáveis `{{contact.name}}` e `{{agent.name}}` (substituição no front — ainda a implementar).

## Oficial vs. não-oficial

Cada número escolhe **como** fala com o WhatsApp:

- **Oficial (Meta Cloud API)** — número de negócio, sem risco de banimento, custa por template enviado.
- **Não-oficial (Evolution API)** — qualquer número, conecta por QR code, grátis, mas viola os termos da Meta e pode ser banido.

A troca é um clique em *Números → Trocar provider*. Detalhes em [04 — Providers](04-providers-whatsapp.md).

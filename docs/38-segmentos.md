# 38 — Segmentos: vendas, administradora, jurídico (avaliação de 18/11/2026)

O produto nasceu para **venda** (lead → atendimento → Comprou/Não comprou). Hoje atende também
administradora de condomínios (ID Vida Urbana, 5 números), academia, estética e deve receber
escritório jurídico. Este documento é a avaliação tela a tela do que "parece venda" para quem não
vende, o que já foi corrigido e o que falta. Complementa [34 — Condomínios](34-condominios.md).

## Como o sistema se adapta a um segmento (as três alavancas)

| Alavanca | O que muda | Onde |
|---|---|---|
| **Modelo de perfil** | Com o que o cliente nasce: perfis, departamentos, tags, motivos, respostas, fluxos, tipos de ticket, agentes de IA, configurações | [20](20-modelos-de-perfil.md) |
| **Encerramento com venda** (`tenant_settings.salesEnabled`) + nomes dos resultados (`wonLabel`/`lostLabel`) | Vocabulário e o que existe de dinheiro: faturamento, ticket médio, pagamentos, valor da venda | Configurações → Atendimento |
| **Recursos do plano** (`PlanLimits.features`) | Telas inteiras (tickets, ranking, pesquisas, agenda, transmissões) | [05](05-planos-e-cobranca.md) |

Regra: **não existe "modo condomínio" nem `if` por segmento.** O texto que nomeia a equipe ou o
contato usa `useVocab()` (`apps/web/src/lib/hooks/configuracoes.ts`, que chama `salesVocab` do `packages/shared/src/vocab.ts`). Nomes das métricas do ranking: `rankingMetricLabel`/`rankingMetricHint`/`rankingMetricsFor` (`shared/ranking.ts`). Testes: `apps/api/test/ranking-weights.test.ts` e `ticket-types.test.ts`.

| | Com venda | Sem venda |
|---|---|---|
| `pessoa` / `pessoas` | Consultor / consultores | Atendente / atendentes |
| `lead` / `leads` | lead / leads | contato / contatos |
| resultado positivo | "Vendas" | `wonLabel` ("Resolvido") |

## Corrigido em 18/11/2026

- **Ranking**: sem venda, o faturamento pesava 35% da nota e era zero para todos. Agora o peso é
  zerado na API (`effectiveRankingWeights`) e a tela vira "Ranking da equipe", sem coluna de
  Faturamento, com "Resolvido" no lugar de Vendas/Conversão (também nos Pesos e na composição).
  Para todos os segmentos: métrica que ninguém pontuou no período (ninguém faturou) fica "sem dado"
  em vez de zero.
- **Metas do mês**: sem venda, só meta de quantidade de "Resolvido" (sem faturamento na barra,
  na tabela, na projeção e no editor).
- **Consultor → Atendente** sem venda: filtros de Conversas (Encerradas) e Relatórios, construtor de
  relatório, relatório de Satisfação, tela de Pesquisas.
- **Origem/campanha de anúncio** some sem venda: chips de origem nos filtros de Conversas e o card
  "De onde vêm os leads" (fica "Tags mais usadas").
- **Fluxos → Encerrar**: sem venda, sem "Valor da venda" e sem "não conta em vendas".
- **Textos de exemplo** neutros (servem a todos): Tags, Transmissões, Respostas, Fluxos,
  Departamentos, fluxo pós-encerramento, relatório diário.
- **Tipos de ticket por nicho**: + **Administradora de condomínios** (2ª via de boleto, Solicitação
  administrativa, Orçamento de prestador, Manutenção) e + **Escritório jurídico** (Consulta inicial,
  Andamento de processo, Envio de documentos, Prazo/audiência).

> ⚠️ Em produção, 4 clientes com nome de farmácia/estética estão com `salesEnabled = false`
> (Drog. Poupe Já, Farmavila Mais, Farmácias Mais Saúde, Estetic Harmony). Com esta mudança eles
> passam a ver "Atendente" e "Ranking da equipe" sem faturamento — coerente com o que configuraram,
> mas vale confirmar se desligaram a venda de propósito.

## Avaliação por segmento

### Vendas (farmácia, loja, academia) — atende bem
Funil (Kanban por tags), Comprou/Não comprou com motivo, valor, orçamento com Pix, ranking e metas.
Falta: **carteira** (ver backlog 2) e a visão do gestor com muitos números (backlog 1).

### Administradora de condomínios — atende a conversa, falta o "caso"
Serve: fila, departamentos, empresas por condomínio com isolamento, escalas, transmissões, tickets.
Falta:
- **Gestor de contrato como dono fixo** do condomínio/contato (backlog 2).
- **Modelo de perfil "Administradora"** pronto: departamentos (Administrativo, Financeiro/Boletos,
  Reservas, Manutenção), `salesEnabled = false`, "Resolvido/Não resolvido", tipos de ticket do nicho
  novo, tags de papel do contato (Gestor predial, Portaria, Síndico, Prestador). Montar num cliente
  de teste → *Gerar de um cliente* (o mecanismo já existe).
- TMA nos relatórios (pendente em [34](34-condominios.md#fase-b--sem-schema-rápido)).

### Escritório jurídico — o que mais falta
O caso dura meses, tem número de processo, prazos e **um advogado responsável**. Hoje:
- **Não há responsável fixo pelo cliente**: cada vez que o cliente escreve, a conversa vai para a fila
  (desde 16/11, reabertura nunca volta sozinha para o antigo dono). Para escritório isso é o
  contrário do esperado — o cliente quer falar com o advogado dele (backlog 2).
- **Sigilo**: quem tem `conversations.view_all` vê tudo. Dá para separar por departamento (área do
  direito), mas não por advogado. Avaliar junto com a carteira.
- **Processo e prazos**: cobertos pelos tipos de ticket novos (número do processo, data do prazo,
  prioridade urgente). Campos do contato (CPF, nº do processo) via
  [campos personalizados](campos-personalizados.md).
- **Modelo de perfil "Escritório jurídico"**: departamentos por área, `salesEnabled = false`,
  resultados "Atendido/Não atendido", respostas rápidas (andamento, documentos, honorários), tipos de
  ticket jurídicos.

## Backlog (ordem sugerida)

1. **Painel de supervisão** para o gestor com muitos números: cartão por número/departamento
   (aguardando, espera mais antiga, em atendimento, paradas), lista "Precisa de atenção" e carga por
   pessoa. Sem schema. Decisões pendentes: cartão por número ou departamento, quem vê, se é recurso
   de plano.
2. **Carteira (responsável pelo contato)**: `contacts.ownerId` opcional (migration aditiva). Contato
   com responsável ativo e com acesso ao número → a conversa reaberta/nova vai direto para ele;
   senão, fila (regra atual). Serve jurídico (advogado), administradora (gestor de contrato) e venda
   (consultor de carteira). Precisa entrar no perfil/modelo como opção ("usa carteira"), como toda
   configuração por pessoa.
3. **Modelos de perfil** "Administradora de condomínios" e "Escritório jurídico" (sem código).
4. **TMA** nos relatórios.
5. Sigilo por responsável (depois da carteira).

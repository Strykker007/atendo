# 34 — Condomínios e operações sem venda (análise e plano)

> Status: **proposta**. Nada aqui está implementado além do que a seção "Já feito" lista.
> Base: levantamento dos módulos (`apps/api/src/modules`), telas (`apps/web/src/app/(app)`) e docs,
> em 28/10/2026. Não é auditoria linha a linha de cada tela.

## Diagnóstico

O produto nasceu com o modelo mental **lead → atendimento → venda** (farmácia, clínica, loja).
A parte de **conversa e equipe** é genérica e serve bem a condomínio; a parte de **resultado e
gestão** pressupõe venda.

| Serve a condomínio hoje | Pressupõe venda |
|---|---|
| Caixa de entrada, fila, assumir/transferir, departamentos (Portaria, Administração, Manutenção) | Encerramento "Comprou/Não comprou" (já dá para renomear e desligar a venda — `salesEnabled`) |
| Escalas, registro de acessos, perfis de acesso | Metas e ranking por faturamento/quantidade de vendas (`docs/metas.md`) |
| Fluxos (menu, horário, **API externa**), respostas rápidas, mensagem fora do expediente | Orçamento com Pix, relatório de Pagamentos |
| Relatório de atendimentos, 1ª resposta, auditoria, pesquisa de satisfação | "Leads", "origem/campanha de anúncio", "Consultor" nos relatórios |
| Transmissões, agendamento, multiempresa (administradora × condomínios) | Kanban usado como funil de vendas |

O que **falta** para condomínio não é esconder venda — é ter os conceitos do domínio:

1. **Quem é o contato.** Morador de qual condomínio, bloco e unidade; proprietário, inquilino,
   síndico, conselheiro, prestador. Hoje só há campos livres por contato (`docs/campos-personalizados.md`):
   não filtram, não segmentam, não aparecem em relatório.
2. **Chamado que dura mais que a conversa.** "Vazamento no 302" é aberto hoje e resolvido em 3 dias,
   com o zelador e uma empresa de fora. O atendimento atual (janela entre encerramentos) termina
   quando a conversa fecha; não há **protocolo**, **categoria**, **prazo**, **responsável** nem
   **status próprio** (aberto, em execução, aguardando terceiro, resolvido).
3. **Comunicado segmentado.** "Falta de água no bloco B amanhã" — transmissão por bloco/condomínio/papel,
   não por tag.
4. **Relatório para o síndico.** Chamados por categoria, por bloco, tempo até resolver (TMA ainda não
   existe), prazo cumprido, satisfação — e um resumo mensal para levar à assembleia. Acesso só leitura.
5. **Rotinas do condomínio.** Reserva de área comum (salão, churrasqueira), aviso de encomenda na
   portaria, 2ª via de boleto (sistema da administradora).

## Princípios (para não quebrar o que existe)

- **Recurso genérico, não "modo condomínio".** Cada peça nova é um recurso que qualquer vertente
  pode usar ("Unidades" serve a sala comercial, lote, quarto de pousada; "Chamados" serve a suporte
  técnico). Liga por `PlanLimits.features` + `@RequireFeature` / `useHasFeature`, nunca por nome de
  plano nem `if` de vertente.
- **Pacote pelo modelo de perfil.** O jeito "condomínio" de nascer (departamentos, tags, motivos,
  fluxo de menu, respostas, `salesEnabled = false`, rótulos "Resolvido/Não resolvido") vai num
  **modelo de perfil "Condomínio"** (`docs/20-modelos-de-perfil.md`) — já existe o mecanismo.
- **Schema só aditivo.** Tabelas novas e colunas opcionais; nada muda para quem não liga o recurso.
- **Vocabulário pelo tipo de operação.** O que depende de venda some/renomeia a partir de
  `salesEnabled` (como Relatórios já faz), não por componente.

## Decisões (28/10/2026)

- **Administradora** = cliente (tenant); **cada condomínio = uma empresa** (`companies`), com os
  **números dele** — um condomínio não enxerga nada do outro. **Condomínio avulso** = cliente com uma
  empresa só (ou nenhuma).
- Equipe: cada usuário vinculado aos condomínios em que trabalha (`user_companies`); o **gestor de
  contratos** fica vinculado a vários; gestores da administradora sem vínculo = veem todos. Isso já
  existe (`docs/empresas.md`).
- Quem conversa: principalmente **gestores prediais e portaria** (não moradores). Por isso "Unidades"
  (bloco/apto) sai da frente; o **papel** do contato (gestor predial, portaria, síndico, prestador,
  morador) pode começar como **tag de contato**, sem schema.
- Demandas: **reservas, boletos, comunicados, solicitações administrativas, orçamento de prestadores**.
- **Visibilidade** (decisão do produto):
  - **Gerente de contrato**: vê tudo de todos os condomínios em que atua (vinculado a vários).
  - **Gestor predial**: vê só o condomínio dele — conversas, contatos, transmissões **e equipe**.
- **Agenda de contatos é por número** e a sincronização é rara. Já é assim: `phonebook_entries` por
  número, releitura completa 1×/dia às 3h (`contacts-sync.ts`), botão manual limitado a 1×/dia por número.
- **Boletos e orçamentos** ficam nos sistemas da própria administradora, que ainda não têm API.
  Integração fica para quando existir — até lá, só registro/acompanhamento no Atendo.

## Lacuna crítica: isolamento por condomínio

O escopo de empresa vira escopo de **números** (`auth/number-scope.ts`), e é respeitado em conversas,
relatórios, Kanban, agendadas, orçamentos, escalas. Pelo levantamento, **não** respeitam:

- **Contatos** (`contacts.module.ts`: lista, exportação, importação filtram só por `tenantId`) — o
  gestor do condomínio A exporta os contatos do B.
- **Transmissões** (`campaigns`): lista e criação por `tenantId`; o número não é conferido contra os
  permitidos e o público pode ser qualquer contato do cliente.
- **Equipe** (`GET /tenants/me/agents`, `tenants.module.ts`): lista todos os usuários do cliente — o
  gestor predial vê (e, com `team.manage`, edita) gente de outros condomínios. Essa lista também
  alimenta filtros de atendente e alvos de transferência.
- **Agenda de serviços** (`scheduling`): profissionais/serviços sem empresa — o salão de festas do A
  aparece no B (relevante quando a reserva entrar).
- Compartilhados por desenho (avaliar caso a caso): tags, respostas rápidas, fluxos, motivos.

Para administradora isso é **pré-requisito**: vem antes de qualquer recurso novo.

## Plano por fases

### Fase A — isolamento por condomínio (pré-requisito)

**Feito em 28/10/2026** (ver `docs/empresas.md` › Equipe, Contatos, Transmissões): equipe, escalas,
registro de acessos, importar/exportar contatos e transmissões no escopo; gestor predial não vê
gerentes sem vínculo na Equipe, mas transfere para eles. Pendente: agenda de serviços (com a Fase D).
O chat interno continua mostrando a equipe toda (é por onde o condomínio fala com a administradora).
Equipe, planilha e transmissões só separam com a chave **"Separar também equipe, contatos e
transmissões por empresa"** ligada (Configurações → Empresas; só o admin da conta) — desligada por
padrão para não mudar nada nas farmácias com filiais. Ligar nas administradoras.


- Contatos: visível = contato com conversa em número permitido (mesma regra do chat); exportar e
  importar no escopo (importação liga o contato ao número escolhido).
- Transmissões: número tem de estar no escopo; público restrito a contatos do escopo; lista mostra só
  as do escopo.
- Equipe: quem é restrito a empresas vê e gerencia só usuários que compartilham ao menos uma empresa
  com ele; criar/editar só pode vincular às próprias empresas.
- Agenda de serviços: `companyId` opcional em profissional/serviço (aditivo; vazio = todas, como hoje)
  — junto com a Fase D (reservas).
- Testes de escopo: usuário do A não lê nem age no B (API, não só tela).

### Fase B — sem schema (rápido)

- [x] Fluxos: atraso antes da 1ª mensagem no bloco Início (`docs/fluxos.md`).

- [x] Relatórios respeitam `salesEnabled` (seção "Resultados", sem faturamento/pagamentos).
- [x] Divisórias de início/fim de atendimento no chat e na auditoria (`docs/08-frontend.md`).
- [x] Exemplos neutros no orçamento (sem remédio).
- [ ] Vocabulário neutro com `salesEnabled = false`: "Consultor" → "Atendente", "leads" → "contatos",
      esconder origem/campanha de anúncio sem dado, metas/ranking só com critérios de atendimento.
- [ ] **TMA** (tempo médio de atendimento) nos relatórios, dos `conversation_events` existentes.
- [ ] **Modelo de perfil "Administradora de condomínios"**: departamentos (Administrativo, Financeiro/
      Boletos, Reservas, Manutenção), tags de contato por papel, motivos de encerramento, fluxo de menu,
      respostas rápidas, `salesEnabled = false`, "Resolvido/Não resolvido".

### Fase C — Solicitações com protocolo

- `requests` (nome a definir): protocolo sequencial por cliente, **empresa (condomínio)**, categoria
  (Administrativa, Reserva, 2ª via de boleto, Comunicado, Manutenção, Orçamento de prestador),
  status próprio, responsável, prazo por categoria, conversa de origem; histórico em tabela própria.
- Abrir do chat ou pelo fluxo; o contato recebe o protocolo e o aviso quando muda de status; consulta
  pelo menu do fluxo.
- **Orçamento de prestador** (sentido inverso do orçamento de venda atual): a solicitação junta as
  cotações (prestador, valor, prazo, PDF), registra quem aprovou e qual foi escolhida.
- Encerrar a conversa **não** fecha a solicitação. Relatórios por condomínio/categoria, tempo até
  resolver, fora do prazo. Feature `requests`.

### Fase D — Rotinas

- **Comunicados** por condomínio + papel (Transmissões no escopo da Fase A + tags de contato).
  Volume alto: número oficial com template (`docs/envio.md`).
- **Reservas** sobre a Agenda por empresa: recurso = área comum, regra por unidade/período.
- **Boletos (2ª via)**: bloco **API externa** dos fluxos contra o sistema da administradora — **aguardando
  a API dela existir**.
- Resumo mensal por condomínio para o síndico (base: `docs/relatorio-diario.md`).

### Depois

- Unidades (bloco/apto) e vínculo contato × unidade, se os moradores passarem a conversar direto.
- Integração nativa com o sistema de gestão condominial.

## Perguntas em aberto

1. Tags, respostas rápidas e fluxos: compartilhados pela administradora ou por condomínio?

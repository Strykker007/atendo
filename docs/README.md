# Documentação do Atendo

| Documento | Para quem | O que responde |
|---|---|---|
| [01 — Visão geral](01-visao-geral.md) | Todos | O que é o produto, quem usa, como os conceitos se relacionam |
| [02 — Rodando local](02-rodando-local.md) | Dev | Passo a passo do zero até ver o painel funcionando, e como resolver os erros comuns |
| [03 — Arquitetura](03-arquitetura.md) | Dev | Monorepo, módulos, fluxo de uma mensagem, filas, tempo real, segurança |
| [04 — Providers WhatsApp](04-providers-whatsapp.md) | Dev / Operação | Como funcionam Meta e Evolution, como trocar, como autenticamos webhooks |
| [05 — Planos, uso e cobrança](05-planos-e-cobranca.md) | Dev / Negócio | Ledger, quota, alertas, excedente, como não ter prejuízo |
| [06 — Modelo de dados](06-modelo-de-dados.md) | Dev | Tabelas, relações e por que cada uma existe |
| [07 — API](07-api.md) | Dev / Integrações | Endpoints, autenticação, exemplos com curl |
| [08 — Front-end](08-frontend.md) | Dev | Estrutura do Next, layout de colunas, estado, tempo real |
| [09 — Roadmap](09-roadmap.md) | Todos | O que está pronto e o que falta, em ordem |
| [10 — Fluxos de automação](10-fluxos-de-automacao.md) | Dev / Cliente | Blocos, gatilhos, motor, editor, API |
| [Fluxos — referência técnica](fluxos.md) | Dev | Arquitetura editor/motor, como criar um bloco, status dos blocos do construtor |
| [Horários e boas-vindas](horarios.md) | Dev / Cliente | Quadro de horários, faixas, estabelecimento fechado, boas-vindas e integração com fluxos |
| [11 — Infra de produção e escala](11-infra-producao.md) | Dev / Ops | Docker, compose de produção, dimensionamento para 500 clientes, migração gradual |
| [12 — Contas e e-mail](12-contas-e-email.md) | Dev / Operação | Convites, esqueci/trocar senha, e-mails transacionais (Resend) |
| [13 — Agendamento](13-agendamento.md) | Dev / Cliente | Profissionais, serviços, agenda, marcação pelo WhatsApp, lembretes ao cliente e ao profissional |
| [14 — Qualidade e observabilidade](14-qualidade-e-observabilidade.md) | Dev / Ops | Testes automatizados, logs estruturados, erros e rastreio em produção |
| [15 — IA](15-ia.md) | Dev / Negócio | Copiloto do atendente, bloco de IA nos fluxos, guarda-corpos, custo e cobrança por interação |
| [16 — Lacunas para o primeiro cliente](16-lacunas-primeiro-cliente.md) | Produto | O que o documento de funções pede, o que já existe e o que falta, em ordem de risco |
| [17 — Entrada em produção](17-entrada-em-producao.md) | Você / Ops | Checklist de go-live: o que criar no Stripe, na Meta, no Resend e no servidor |
| [18 — Perfis de acesso](18-perfis-de-acesso.md) | Dev / Produto | Permissões configuráveis por cliente: catálogo, guards e as travas contra escalada |

Convenção: código em inglês, comentários e documentação em português.

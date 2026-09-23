# 09 — Roadmap

## Pronto (2026-09-16)

- Monorepo, infra Docker (Postgres, Redis, Evolution), migrations e seed
- Auth: login, refresh rotativo, RBAC, throttling
- Números: cadastro, QR da Evolution em tempo real, troca de provider, revalidar, ativar/desativar, excluir
- Adapters Meta e Evolution (envio de texto/mídia por URL, recepção, status, conexão)
- Webhooks autenticados + filas BullMQ (inbound/outbound com retry)
- Conversas: lista com filtros (status, número, busca, tags), chat estilo WhatsApp, envio, encerrar/reabrir, tags no cabeçalho
- Respostas rápidas (pastas → respostas → insere no composer)
- Billing: planos, ledger, contadores Redis, quota antes de enviar, alertas 80/100% (log), reconciliação diária, `GET /billing/usage`
- Relatórios: endpoint `POST /reports/run` com DSL segura
- Telas de administração: Tags (CRUD), Equipe (criar, ativar/desativar, redefinir senha), Plano e uso (medidores, excedente, banner global 80/100%), Configurações (pastas e respostas rápidas)
- Variáveis `{{contact.name}}` / `{{agent.name}}` substituídas ao inserir resposta rápida
- Toasts e diálogos de confirmação próprios (sem `alert`/`confirm`)
- Mídia: receber (download do provider → storage privado), exibir imagem/áudio/vídeo/documento, enviar com anexo e legenda; storage `local` (grátis) ou `s3` por env; URLs assinadas
- Origem do lead: referral de anúncio (Meta e Evolution) → `origin`/`originData`, tags automáticas, filtro e relatório por campanha
- Tema claro (Semáforo) e escuro (Sala de controle) com tokens; seleção em Configurações
- Relatórios: construtor de parâmetros, gráfico (linha/barra/pizza), tabela, CSV, relatórios salvos
- Posse do atendimento: assumir (atômico), transferir, devolver à fila; visão por atendente; admin vê todas
- Cobrança Stripe: checkout, troca de plano com proration, portal do cliente, webhooks, excedente na fatura, suspensão por carência, faturas na tela, margem por cliente (super_admin)
- Papel gerente; cadeado com notas internas; financeiro completo do dono (KPIs, série mensal, assinaturas, faturas, margem); densidade visual
- Fluxos de automação: editor visual (React Flow), motor (menu, pergunta com validação, condição, ação, aguardar, handoff), gatilhos manual/nova conversa/palavra-chave, aba Fluxos no chat, feature por plano
- Dono: tela Clientes (criar, plano, status, ativar/desativar) e 'Entrar como' (impersonação com faixa e saída)
- Infra: Dockerfiles (api/worker/web), compose de produção com Caddy/HTTPS, Socket.IO em cluster (Redis), /health, shards da Evolution, CI
- Contas: convite por e-mail (equipe e admin de cliente), esqueci/redefinir/trocar senha; e-mails de alerta de plano, cobrança falhou e suspensão (Resend)
- Agendamento (plugável): profissionais com horários, serviços, agenda por dia, marcação pelo WhatsApp (bloco no fluxo), pelo chat e pela agenda, lembretes ao cliente (1 confirma / 2 remarca) e aviso ao profissional com histórico do cliente
- Testes: 151 testes unitários (Vitest) nos pontos de risco — adapters Meta/Evolution, fuso e disponibilidade da agenda, interpretação de resposta em fluxos, quota/excedente, DSL de relatórios, logger e contexto, quota e prompts de IA; `pnpm test` no CI
- Observabilidade: log estruturado (JSON em produção), `requestId` por requisição no cabeçalho e nas respostas de erro, log de acesso com duração, filtro global de exceções, contexto e falhas de job nas filas, Sentry opcional
- IA (plugável): copiloto do atendente (sugerir resposta, reescrever em 4 tons, resumir a conversa — sempre com o humano enviando) e bloco de IA no editor de fluxos (responder com base de conhecimento ou classificar para rotear); adapters Anthropic/OpenAI trocáveis por config, ledger `ai_usage`, cobrança por interação com excedente e teto de gasto
- Documentação (esta pasta)

## Próximos, em ordem sugerida

1. **IA, etapa 3** — agente autônomo: base de conhecimento por arquivo (PDF/planilha) com busca vetorial no `pgvector`, resposta fora do fluxo em toda conversa nova e handoff por confiança. As etapas 1 e 2 (bloco de IA no fluxo e copiloto) estão prontas — ver [15](15-ia.md).
2. **Templates Meta** — listar templates aprovados da WABA e compor no chat quando a janela expirou.
3. **Validar com credencial real** — Meta (WABA de teste), Stripe (chaves de teste) e Resend nunca rodaram fora do simulado. É o maior risco em aberto.
4. **Testes de integração** — e2e de receber → responder com banco e fila de verdade (os atuais são unitários e offline).
5. **Métricas e alerta** — profundidade das filas e falhas de envio num endpoint Prometheus; alerta ativo quando uma fila acumula ou um número cai.
6. **2FA** (TOTP) para admins.
7. **Atribuição automática** de conversas (round-robin entre atendentes online) — a posse manual já existe.

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
- Documentação (esta pasta)

## Próximos, em ordem sugerida

1. **Alertas por e-mail** — provedor (Resend/SES) + template; banner no painel.
2. **Templates Meta** — listar templates aprovados da WABA e compor no chat quando a janela expirou.
3. **Testes** — unit nos adapters (parseWebhook com payloads reais gravados), e2e do fluxo enviar/receber.
4. **Produção** — Dockerfile da API/worker/web, `migrate deploy`, HTTPS, variáveis, observabilidade (logs estruturados, Sentry).
5. **2FA** (TOTP) para admins.
6. **Atribuição automática** de conversas (round-robin entre atendentes online) — a posse manual já existe.

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
- Documentação (esta pasta)

## Próximos, em ordem sugerida

1. **Telas restantes** — Tags (CRUD), Equipe (atendentes), Plano e uso (barras de consumo + banner 80/100%), Configurações (respostas rápidas CRUD).
2. **Mídia** — baixar do provider ao receber, subir para S3/R2, exibir imagem/áudio/documento nas bolhas; upload no composer.
3. **Relatórios (tela)** — construtor de parâmetros + Recharts + salvar relatório.
4. **Variáveis nas respostas rápidas** — substituir `{{contact.name}}` / `{{agent.name}}` ao inserir.
5. **Alertas por e-mail** — provedor (Resend/SES) + template; banner no painel.
6. **Fechamento de fatura + gateway** — Asaas ou Stripe (decisão pendente); webhook de pagamento; suspensão com grace.
7. **Relatório de margem** (super_admin) — receita − custo por tenant.
8. **Templates Meta** — listar templates aprovados da WABA e compor no chat quando a janela expirou.
9. **Testes** — unit nos adapters (parseWebhook com payloads reais gravados), e2e do fluxo enviar/receber.
10. **Produção** — Dockerfile da API/worker/web, `migrate deploy`, HTTPS, variáveis, observabilidade (logs estruturados, Sentry).
11. **2FA** (TOTP) para admins.
12. **Atribuição automática** de conversas (round-robin entre atendentes online).

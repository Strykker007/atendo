# Atendo — guia para o Claude

Monorepo pnpm/Turborepo. `apps/api` (NestJS + Prisma), `apps/web` (Next.js App Router), `packages/shared` (tipos canônicos). Leia o README e a pasta `docs/` para o contexto de produto. **Sempre que mudar comportamento, endpoint, schema ou fluxo, atualize o doc correspondente em `docs/` na mesma tarefa** — documentação desatualizada é bug.

## Regras do projeto
- Idioma do código: identificadores em inglês, comentários e textos de UI em português.
- Nunca concatenar input do usuário em SQL — use Prisma ou `Prisma.sql` parametrizado (ver `reports.module.ts`).
- Toda query de dados do tenant filtra por `tenantId` do `AuthUser` (nunca do body/query).
- Credenciais de provider vão no banco só via `CryptoService.encryptJson`.
- UI, banco e filas só conhecem `InboundMessage`/`OutboundMessage`; lógica específica de Meta/Evolution fica dentro do adapter.
- Cada mensagem enviada/recebida obrigatoriamente passa por `UsageService.record` (é o ledger de cobrança).
- Antes de enviar: `UsageService.canSend` (quota) + regra da janela de 24h da Meta.

## Comandos
- `pnpm typecheck` / `pnpm build` — sempre rodar antes de concluir uma tarefa.
- `pnpm db:migrate` após alterar `apps/api/prisma/schema.prisma`; `pnpm db:generate` regenera o client.
- `pnpm --filter @atendo/shared build` após alterar `packages/shared` (a API consome o `dist`).

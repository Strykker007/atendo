# Atendo — guia para o Claude

Monorepo pnpm/Turborepo. `apps/api` (NestJS + Prisma), `apps/web` (Next.js App Router), `packages/shared` (tipos canônicos). Leia o README e a pasta `docs/` para o contexto de produto. **Sempre que mudar comportamento, endpoint, schema ou fluxo, atualize o doc correspondente em `docs/` na mesma tarefa** — documentação desatualizada é bug.

## 🚨 REGRAS DE ECONOMIA DE TOKENS (OBRIGATÓRIO)
- NÃO use comandos Bash para rodar servidores de desenvolvimento (ex: `pnpm dev`, `next dev`). O usuário gerencia o servidor externamente.
- NÃO execute comandos de build global ou typecheck (`pnpm build`, `pnpm typecheck`) de forma autônoma, a menos que o usuário peça explicitamente. O usuário rodará isso no terminal dele para poupar contexto.
- NÃO use ferramentas de busca global por todo o monorepo. Se precisar de um arquivo, pergunte o caminho ou limite a busca à pasta específica (ex: `apps/api` ou `apps/web`).
- Seja extremamente direto nas respostas. Foque apenas no código e na modificação cirúrgica.
- ÁREAS BLOQUEADAS (NÃO LER/INDEXAR): `.next/`, `node_modules/`, `dist/`, `build/`, `.turbo/`.

## Regras do projeto
- Idioma do código: identificadores em inglês, comentários e textos de UI em português.
- Nunca concatenar input do usuário em SQL — use Prisma ou `Prisma.sql` parametrizado (ver `reports.module.ts`).
- Toda query de dados do tenant filtra por `tenantId` do `AuthUser` (nunca do body/query).
- Credenciais de provider vão no banco só via `CryptoService.encryptJson`.
- UI, banco e filas só conhecem `InboundMessage`/`OutboundMessage`; lógica específica de Meta/Evolution fica dentro do adapter.
- Cada mensagem enviada/recebida obrigatoriamente passa por `UsageService.record` (é o ledger de cobrança).
- Antes de enviar: `UsageService.canSend` (quota) + regra da janela de 24h da Meta.
- Funcionalidade nova que deve ser cobrada à parte: entra em `PlanLimits.features` + `@RequireFeature('x')` na API + `useHasFeature('x')` no front — nunca um if solto por nome de plano.

## Comandos (Apenas para referência do usuário - Claude NÃO deve rodar sozinho)
- `pnpm typecheck` / `pnpm build` — sempre rodar antes de concluir uma tarefa.
- `pnpm db:migrate` após alterar `apps/api/prisma/schema.prisma`; `pnpm db:generate` regenera o client.
- `pnpm --filter @atendo/shared build` após alterar `packages/shared` (a API consome o `dist`).

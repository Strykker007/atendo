# ---- API / worker do Atendo ----
# Uma imagem para os dois processos: CMD padrão é a API; o worker sobrescreve o comando.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @atendo/api... --filter @atendo/shared

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY tsconfig.base.json ./
RUN pnpm --filter @atendo/shared build \
 && pnpm --filter @atendo/api prisma generate \
 && pnpm --filter @atendo/api build \
 && pnpm --filter @atendo/api --prod deploy --legacy /out \
 # o client gerado do Prisma fica no virtual store do build; o deploy copia o pacote "cru" da store — leva o gerado junto
 && cp -r /app/node_modules/.pnpm/@prisma+client*/node_modules/.prisma /out/node_modules/.pnpm/@prisma+client*/node_modules/

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/packages/shared/dist ./node_modules/@atendo/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@atendo/shared/package.json
RUN mkdir -p storage && chown -R app:app /app
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://localhost:4000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# API: aplica migrations e sobe. Worker: `node dist/src/worker`
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]

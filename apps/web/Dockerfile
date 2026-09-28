# ---- Web (Next.js) do Atendo ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @atendo/web... --filter @atendo/shared

FROM deps AS build
# NEXT_PUBLIC_* entram no bundle em build time
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL NEXT_TELEMETRY_DISABLED=1
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY tsconfig.base.json ./
RUN pnpm --filter @atendo/shared build && pnpm --filter @atendo/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/apps/web/.next-build/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next-build/static ./apps/web/.next-build/static
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

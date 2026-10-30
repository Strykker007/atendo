# ---- Site público (Next.js) da VogoChat — docs/21-site.md ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/site/package.json apps/site/
RUN pnpm install --frozen-lockfile --filter @atendo/site...

FROM deps AS build
# NEXT_PUBLIC_* entram no bundle em build time
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_TELEMETRY_DISABLED=1
COPY apps/site apps/site
COPY tsconfig.base.json ./
RUN pnpm --filter @atendo/site build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/apps/site/.next-build/standalone ./
COPY --from=build --chown=app:app /app/apps/site/.next-build/static ./apps/site/.next-build/static
# o `standalone` do Next NÃO leva o public/ junto (logo, vídeos, og)
COPY --from=build --chown=app:app /app/apps/site/public ./apps/site/public
USER app
EXPOSE 3000
CMD ["node", "apps/site/server.js"]

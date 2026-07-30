FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY vendor/minimatch-compat ./vendor/minimatch-compat
RUN npm ci --legacy-peer-deps --workspace=apps/api --include-workspace-root

COPY apps/api ./apps/api
RUN npm run db:generate --workspace=apps/api && npm run build:api

ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "npm run db:migrate:deploy --workspace=apps/api && npm run start --workspace=apps/api"]

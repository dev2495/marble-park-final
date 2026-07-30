FROM node:22-bookworm-slim AS base

WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY vendor/minimatch-compat ./vendor/minimatch-compat
RUN npm ci --legacy-peer-deps --workspace=apps/web --include-workspace-root

COPY apps/web ./apps/web
COPY scripts ./scripts
ARG NEXT_PUBLIC_API_URL=https://api-production-bc49.up.railway.app/graphql
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build:web

ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "npm run start --workspace=apps/web -- -p ${PORT:-3000}"]

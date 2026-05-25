FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run db:generate --workspace=apps/api && npm run build:api

ENV NODE_ENV=production
CMD ["sh", "-c", "npm run db:migrate:deploy --workspace=apps/api && npm run start --workspace=apps/api"]

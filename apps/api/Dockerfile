FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run db:generate && npm run build

ENV NODE_ENV=production
CMD ["sh", "-c", "npm run db:migrate:deploy && npm run start"]

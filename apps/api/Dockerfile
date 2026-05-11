FROM node:20-bookworm-slim AS base

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run db:generate && npm run build

CMD ["sh", "-c", "npm run db:migrate:deploy && npm run start"]

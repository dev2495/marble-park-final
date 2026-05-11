FROM node:20-bookworm-slim AS base

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000}"]

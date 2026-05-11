FROM node:22-bookworm-slim AS base

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

ENV NODE_ENV=production
CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000}"]

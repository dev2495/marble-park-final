FROM node:22-bookworm-slim AS base

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
ARG NEXT_PUBLIC_API_URL=https://api-production-bc49.up.railway.app/graphql
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build

ENV NODE_ENV=production
CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000}"]

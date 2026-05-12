# Railway Deployment Runbook

This app is a shared npm monorepo with two deployable services:

- `api`: NestJS GraphQL API in `apps/api`
- `web`: Next.js app in `apps/web`

Use one Railway project with three services: Postgres, API, and Web.

## 1. Postgres

Create a Railway Postgres service first. Railway injects its `DATABASE_URL` into linked services through service variables.

## 2. API Service

Create a GitHub-backed service from this repo.

Settings:

- Root directory: `/`
- Build command: `npm ci && npm run db:generate --workspace=apps/api && npm run build:api`
- Start command: `npm run db:migrate:deploy --workspace=apps/api && npm run start --workspace=apps/api`
- Generate a Railway public domain.
- Add a volume mounted at `/data` for extracted catalogue images.

Variables:

```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<generate-a-long-random-secret>
CORS_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
CATALOGUE_IMPORT_IMAGE_DIR=/data/catalogue-images/imports
CATALOGUE_IMAGE_STORAGE_DIR=/data/catalogue-images
PUBLIC_CATALOGUE_IMAGE_BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
QUOTE_PDF_EMAIL=admin@marblepark.com
QUOTE_PDF_PASSWORD=password123
```

Notes:

- Replace `Postgres` and `web` with the exact Railway service names if different.
- `QUOTE_PDF_*` lets the Next PDF route fetch protected quote data server-side.
- Change the seeded admin password after first login if this is shared outside internal testing.
- Manual SKU, profile and quote images are stored by the API under `CATALOGUE_IMAGE_STORAGE_DIR` and served from `/catalogue-images/manual/...`, so the API volume is the persistent image store.

## 3. Web Service

Create a second GitHub-backed service from the same repo.

Settings:

- Root directory: `/`
- Build command: `npm ci && NEXT_PUBLIC_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}/graphql npm run build:web`
- Start command: `npm run start --workspace=apps/web -- -p $PORT`
- Generate a Railway public domain.

Variables:

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}/graphql
QUOTE_PDF_EMAIL=admin@marblepark.com
QUOTE_PDF_PASSWORD=password123
```

Notes:

- Replace `api` with the exact Railway API service name if different.
- `NEXT_PUBLIC_API_URL` is required at build time because Next embeds it into the client bundle.

## 4. First-Time Seed

Only run this once on a fresh testing database:

```bash
npm run db:seed --workspace=apps/api
```

Do not run seed on a database with client-entered testing data; the seed script resets core demo data.

## 5. Post-Deploy Smoke Checks

After both services are deployed:

```bash
API_URL=https://<api-domain>/graphql node scripts/regression-smoke.mjs
API_URL=https://<api-domain>/graphql WEB_URL=https://<web-domain> npm run smoke:intent-order
API_URL=https://<api-domain>/graphql WEB_URL=https://<web-domain> npm run smoke:quote-notifications
```

For PDF/excel readiness, run against a controlled test PDF only if the deployment volume has enough space:

```bash
API_URL=https://<api-domain>/graphql WEB_URL=https://<web-domain> READINESS_PDF="/path/to/catalogue.pdf" npm run smoke:readiness
```

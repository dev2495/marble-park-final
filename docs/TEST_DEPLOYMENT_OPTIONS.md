# Marble Park Testing Deployment Options

Date: 2026-05-07

## Recommendation

Use Render for the first client testing deployment of this current codebase.

Reason: the app is currently a split full-stack system:

- `apps/api`: NestJS GraphQL API with Prisma/Postgres and PDF/Excel import workers.
- `apps/web`: Next.js app that talks to the API through `NEXT_PUBLIC_API_URL`.
- PDF catalogue image extraction writes runtime image files, so the API must serve those images or the app needs object storage.

A web-only Vercel deployment would be incomplete because it would not host the long-running Nest API or the runtime catalogue image extraction path.

## Cheapest workable options checked

### Option A: Render Blueprint, cheapest full-stack test path

Use `render.yaml` in the repo root.

What it creates:

- `marble-park-api`: free Render web service for the Nest API.
- `marble-park-web`: free Render web service for the Next app.
- `marble-park-postgres`: free Render Postgres for testing.

Important limit: Render free Postgres is currently listed as `$0` with a 30-day limit. This is acceptable for short client testing, not long-term production.

After first deploy, run database setup against the Render database:

```bash
npm run db:push --workspace=apps/api
npm run db:seed --workspace=apps/api
```

Only run seed on a new test database because the current seed resets demo data.

### Option B: Vercel Hobby + Neon Free

This is cheap for a Next.js + Postgres app, but not a complete fit for this repo today.

Why not first choice right now:

- Vercel would deploy the web app cleanly.
- Neon would host Postgres free for small testing data.
- The separate Nest API still needs a host.
- Runtime PDF image extraction needs API-hosted static files or object storage.

This can become the best option later if the API is moved into Next server routes/functions or if we deploy API separately and use object storage for extracted images.

## Deployment-specific fix added

The API now serves extracted catalogue images at:

```text
/catalogue-images/imports/<file>.png
```

Deployment envs:

```text
CATALOGUE_IMPORT_IMAGE_DIR=/opt/render/project/src/apps/api/public/catalogue-images/imports
PUBLIC_CATALOGUE_IMAGE_BASE_URL=https://marble-park-api.onrender.com
```

This makes image review tasks use API-hosted image URLs instead of relying only on the Next build-time `public` folder.

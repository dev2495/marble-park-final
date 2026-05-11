# Prisma Migrations

Production deploys run `prisma migrate deploy` automatically (see `render.yaml` →
`apps/api` `startCommand`). Two migrations exist today:

1. **`0_init`** – baseline. Reproduces the schema as it was managed by
   `prisma db push` before migrations were adopted.
2. **`20260510000000_add_hot_path_indexes`** – adds B-tree indexes on hot
   filter / join columns (Reservation `(quoteId,status)` + `(productId,status)`,
   Quote `leadId/customerId/ownerId/status`, Lead, Activity, Customer, etc.).
   Uses `CREATE INDEX IF NOT EXISTS` for idempotency.

## Bootstrapping an existing database (one-time, per environment)

If a database was previously managed by `prisma db push` (i.e. tables already
exist but the `_prisma_migrations` table does not), mark the baseline as
already applied **before** the first deploy:

```bash
DATABASE_URL=... npx prisma migrate resolve --applied 0_init
```

Then `prisma migrate deploy` will pick up only `20260510000000_add_hot_path_indexes`
and any future migrations.

## Fresh databases

No bootstrap needed — `prisma migrate deploy` runs both migrations in order.

## Adding new migrations

```bash
npm run db:migrate:dev --workspace=apps/api -- --name <descriptive_name>
```

Commit the generated folder under `prisma/migrations/`. Production picks it up
on next deploy.

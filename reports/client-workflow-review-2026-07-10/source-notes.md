# Marble Park client workflow review - source notes

Generated: July 10, 2026

## Reporting job

- Audience: product stakeholders.
- Question: how should the four client requests be represented in Marble Park, what is already implemented, what is missing end to end, and what other adjacent capabilities are needed?
- Scope: current `main` source, Prisma schema and migrations, frontend pages, GraphQL services and permissions, document/stock/procurement/dispatch paths, automated checks, dependency audit, and read-only Railway state.
- Constraint: no application, database, or hosting changes; no mutating smoke against client data.
- Success criterion: an implementation-ready design and release gate that preserves one quote while supporting immutable SKU, editable commercial content, canonical rate, and multiple partial sales orders.

## Executive report structure map

- Title: Marble Park Client Workflow Readiness.
- Executive summary: direct answer and operational blocker.
- Key findings with visual evidence: five-layer requirement coverage chart.
- Recommended next steps: ordered implementation sequence.
- Further questions: client policy defaults to confirm.
- Caveats and assumptions: no-change boundary, local verification, production outage.

## Client source

WhatsApp image supplied by the user, `WhatsApp Image 2026-07-07 at 12.51.40.jpeg`:

1. Master product can be edited, including images and rates; SKU cannot be changed.
2. Quotes can be created without intents or leads.
3. Rate field should be available while making a quote.
4. A quote can be converted into multiple partial sales orders so staff do not create multiple quotes for one customer.

## Repository evidence

### Product Master

- `apps/api/src/modules/products/products.resolver.ts:91-127`: update input includes commercial and media fields but excludes SKU.
- `apps/api/src/modules/products/products.service.ts:126-131`: backend update exists.
- `apps/api/src/modules/products/products.service.ts:134-149`: archive/delete path rewrites SKU when reservations or movements exist.
- `apps/web/src/app/dashboard/master-data/products/page.tsx:39-153`: Product Master is create-only and links the register to the catalogue.
- `apps/web/src/app/dashboard/products/page.tsx:88-335`: catalogue is browse/gallery only and does not consume the `sku` query parameter from Product Master links.
- No automated test invokes `updateProduct`.

### Direct quote

- `apps/web/src/app/dashboard/quotes/new/page.tsx:61-133`: Quote Studio creates from customer and lines without sending lead or intent.
- `apps/api/src/modules/quotes/quotes.resolver.ts:94-130`: lead is nullable on GraphQL create input.
- `apps/api/src/modules/quotes/quotes.service.ts:101-144`: service creates an internal lead when lead ID is absent.
- Current smoke scripts create quotes from explicit leads or intents; no no-lead regression case exists.

### Quote rate and totals

- `apps/web/src/app/dashboard/quotes/new/page.tsx:232-242`: Rate column is displayed as text, not an input.
- `apps/web/src/app/dashboard/quotes/[id]/page.tsx:36-43`: detail UI calculates special rate and line discount.
- `apps/web/src/app/dashboard/quotes/[id]/page.tsx:270-274`: MRP and discount are editable; final rate is display-only.
- `scripts/render-quote-pdf.cjs:160-166` and `scripts/render-sales-order-pdf.cjs:110-113`: PDFs apply special rate or line discount.
- `apps/api/src/modules/quotes/quotes.service.ts:387-394,905-910`: sales-order total uses raw price and ignores line special rate, line discount, quote discount, and tax.
- `apps/api/src/modules/quotes/quotes.service.ts:549-595` and `apps/api/src/modules/common/stock-posting.ts:301-345`: normalized unit price and totals use raw price.

### Partial sales orders

- `apps/api/prisma/schema.prisma:572-595`: `SalesOrder.quoteId` is unique.
- `apps/api/prisma/schema.prisma:113-132`: `DispatchJob.quoteId` is unique.
- `apps/api/src/modules/quotes/quotes.resolver.ts:163-176`: sales-order input has quote, payment mode, advance, and notes only; no selected lines.
- `apps/api/src/modules/quotes/quotes.service.ts:387-457`: conversion uses all quote lines and returns the existing order for a repeated quote conversion.
- `apps/api/src/modules/common/stock-posting.ts:287-363`: order-line sync looks up one sales order by quote ID.
- `apps/api/src/modules/dispatch/dispatch.service.ts:80-210`: dispatch maps one order per quote.
- `apps/web/src/app/dashboard/quotes/[id]/page.tsx:280-285`: UI has a single full-quote Create sales order action.
- `apps/web/src/app/dashboard/dispatch/page.tsx:114-163`: partial challans exist, but they split dispatch after one full sales order; they do not satisfy partial order creation.

### Security, integrity, and delivery

- `apps/api/src/app.module.ts`: GraphQL playground is enabled unconditionally.
- `apps/api/src/main.ts:11-16`: very large JSON body limit and public static manual assets.
- `apps/api/src/modules/imports/imports.resolver.ts:164-181`: broad-role upload writes arbitrary extension content with no MIME, signature, or size validation.
- `apps/web/src/lib/apollo-client.ts:10-20`: bearer session token is stored in browser local storage.
- `apps/api/src/modules/auth/auth.service.ts:29-89`: login has no throttling or lockout.
- `apps/api/prisma/migrations/20260524100000_production_hardening_models/migration.sql`: normalized operational tables have indexes but no foreign-key constraints.
- `apps/api/Dockerfile` and `apps/web/Dockerfile`: production image uses `npm install --legacy-peer-deps` rather than lockfile-clean installation.
- Railway read-only service list: web and API status failed/stopped, no running replicas, source null, no health checks; public domains returned `404 Application not found`.

### User database review

- Read-only aggregate query target: local `postgresql://localhost/marble_park` configured in `apps/api/.env`; credentials and personally identifiable fields were not printed or included in the report.
- Account status: 98 total users, 37 active, 61 inactive.
- Active roles: admin 1, dispatch operations 1, inventory manager 1, office staff 27, owner 2, sales 4, sales manager 1.
- Inactive roles: dispatch operations 15, owner 15, sales 31.
- Authentication metadata: 751 stored sessions, all expired; zero unexpired sessions; 82 users have `passwordChangedAt`, 16 do not; 3 users have non-empty permission overrides.
- Account creation range: April 29 through June 19, 2026.
- Production limitation: Railway variables confirm a TCP proxy mapped to PostgreSQL port 5432, but the production Postgres service has no active deployment. Both `railway connect Postgres` and its SSH-tunnel mode closed before authentication, so production user counts are not claimed.

## Verification evidence

- `npm run build`: pass for API and web; Next production build generated all routes.
- `DATABASE_URL=postgresql://audit:audit@localhost:5432/audit npx prisma validate --schema apps/api/prisma/schema.prisma`: pass.
- `npm audit --omit=dev --json`: one low, four moderate, six high, zero critical advisories in the current production dependency graph.
- `git diff --check`: pass before report creation.
- Mutating E2E scripts were not run because they create products, users, customers, leads, quotes, stock, orders, payments, procurement records, challans, and returns.

## Chart map

- Section: Only direct quote creation is functionally ready.
- Question: how many of the five delivery layers are implemented, partial, or missing for each client request?
- Family/type: comparison and composition; stacked horizontal bar.
- Fields: request, state, layers, layer definition.
- Claim: direct quote creation is substantially implemented; all other requests require material completion, and partial sales order is a cross-stack change.
- Palette: semantic green for implemented, blue for partial, orange for missing; labels and ordering provide non-color distinction.
- Delivery: Recharts self-contained HTML with same-data static SVG fallback, then Chrome PDF.

## Omitted evidence

- Production database contents could not be queried because the Postgres service has no active deployment behind its configured proxy. A restart or redeploy would change live state and was outside the no-change boundary.
- Authenticated production workflows were not executed because login creates sessions and audit records and the public services are offline.
- Runtime browser QA of authenticated product/quote/order pages was unavailable because the API is offline; final report HTML and PDF are still browser-rendered and visually checked.

# Marble Park ERP Implementation Report

Date: 2026-04-29

## Scope Completed

Implemented the audit fixes for the current Marble Park app pass, excluding proof upload as requested.

## Server And Business Logic

- Added reusable session/RBAC helpers: `requireSession`, `requireRoles`, `isPrivileged`.
- Locked public GraphQL access for products, customers, leads, quotes, inventory, dispatch, search, imports, documents and system admin endpoints.
- Sales users are scoped server-side for lead and quote lists/details.
- User management remains admin/owner-only, including `user(id)`.
- Quote creation now sets approval state based on discount threshold.
- Quote send/confirm now blocks when approval is pending.
- Added `approveQuote` mutation for admin/owner/sales manager.
- Quote confirmation now creates reservations and dispatch job once.
- Quote lost/expired releases reserved inventory.
- Inventory updates now recalculate `available = onHand - reserved - damaged - hold`.
- Inventory adjustments now record the actor instead of hardcoded `system`.
- Dispatch challan creation now moves job to `packed`.
- Dispatch challan status `dispatched` now creates inventory movement and consumes reserved/on-hand stock.
- Dispatch challan status `delivered` now closes the job to delivered.
- Added `dispatchChallans` query.
- Import processing now stages rows into `SourceFile`, `ImportBatch`, and `ImportRow` instead of directly mutating products.
- Added `applyImportBatch` mutation to explicitly apply reviewed staged rows.
- Added system admin module for settings, audit events, catalogue review tasks, and catalogue image mapping.
- Added customer master fields to schema: GST number, state, designer, notes and tags.
- Backend document GraphQL contract now returns typed fields and points to the working PDF route.
- Removed stale `SHIVDHARA` branding from backend document template.
- Quote PDF renderer now reads quotes directly from Prisma so PDF downloads still work after GraphQL RBAC locking.

## Frontend

- Added `/dashboard/master-data` for admin/owner/inventory manager:
  - Company and rule settings.
  - Import batch review/apply queue.
  - Catalogue image review queue.
  - Audit trail.
- Added direct frontend role gate for master data. Sales users now see a restricted state instead of blank admin data.
- Added `/dashboard/quotes/approvals` approval desk.
- Added approval link from quote register.
- Updated dispatch page with challan create, dispatch and deliver actions.
- Added Master Data navigation item for admin/owner/inventory manager.

## Verification Evidence

Commands run successfully:

- `npm run db:generate --workspace=apps/api`
- `npm run db:push --workspace=apps/api`
- `npm run build:api`
- `npm run build:web`
- `node scripts/regression-smoke.mjs`

Runtime checks:

- Public `quotes` GraphQL query now returns `Login required`.
- Admin `appSettings`, `importBatches`, `catalogReviewTasks`, and `auditEvents` query works.
- Sales user quote list is scoped to own quotes in regression smoke.
- Quote PDF route returned `HTTP/1.1 200 OK`, `content-type: application/pdf`, one-page PDF.
- Browser check of `/dashboard/master-data` under sales user shows the restricted page with no console errors.

Generated screenshot:

- `marble-park-master-data-restricted.png`

Generated PDF smoke file:

- `/tmp/mp_quote_after.pdf`

## Known Residual Work

The requested proof upload was intentionally left out.

The following are improved but should be expanded in a next pass for a hardened production ERP:

- Dashboard read endpoints are session-protected but still broad because the existing dashboard page requests all role widgets in one query. Write/mutation endpoints are role-restricted.
- Quote line items still live in JSON. A future `QuoteLine` table would make reporting, reservations and partial dispatch more robust.
- Dispatch partial quantities use challan line JSON. A future `DispatchLine` table is recommended.
- Catalogue exact image matching infrastructure exists through review tasks, but existing extracted images are not automatically converted into human-reviewed exact matches.
- Audit logging is implemented for quote/settings/catalogue mapping paths; remaining mutations should be expanded to write audit events consistently.
- Email/WhatsApp delivery is not fully wired to a production provider; quote PDF download works.

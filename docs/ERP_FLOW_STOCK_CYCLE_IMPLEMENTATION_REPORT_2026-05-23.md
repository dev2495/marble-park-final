# ERP Flow Stock Cycle Implementation Report

Date: 2026-05-23
Source audit: `docs/ERP_FLOW_STOCK_CYCLE_GAP_AUDIT_2026-05-22.md`
Status: GREEN for local code, migration, API, web build, smoke flows, and browser QA.

## Implemented outcome

The stock-cycle flow is now centered around one operational path:

Lead/Quote -> Sales Order -> Reservation or Backorder -> Purchase Demand -> Purchase Order -> GRN -> Ready Dispatch -> Challan -> Delivered.

The previous direct shortcuts were tightened so users are guided through the correct operational flow instead of creating stock or dispatch side effects from the wrong screen.

## Backend changes

- Added procurement data models for purchase demands, purchase orders, purchase order lines, goods receipt notes, and goods receipt lines.
- Added a procurement GraphQL module for demand queue, purchase order creation, GRN receiving, and recent GRN visibility.
- Changed quote confirmation so it no longer creates reservations or dispatch jobs unless a sales order exists.
- Made sales order creation generate purchase demands for backordered items and tile special-order lines.
- Added partial reservation support, so available stock is reserved and shortage becomes a backorder instead of failing as all-or-nothing.
- Made dispatch challan creation require a linked sales order and ready lines.
- Prevented mixed dispatch jobs from auto-dispatching pending lines.
- Made tile special-order dispatch readiness depend on received procurement stock.
- Fixed delivered status aggregation so one delivered challan does not close a partially delivered job.
- Added duplicate-consumption protection when a challan status is updated repeatedly.
- Made inventory creation idempotent for product-created zero balances.
- Updated low-stock logic to use product reorder points or configured low-stock thresholds.
- Fixed vendor role mapping to use `dispatch_ops`.
- Changed user deletion to soft-disable users.
- Exposed user profile fields through user create/update inputs.

## UI changes

- Added a Procurement Control page at `/dashboard/procurement`.
- Added navigation for Procurement under Stock.
- Updated Pending Inward to show PO/GRN status, vendor, ETA, and purchase demand context.
- Converted Inventory Inwards into a controlled manual GRN receipt screen.
- Removed standalone quote-confirm actions from quote list/detail pages so conversion to sales order is the canonical path.
- Updated dispatch copy and empty states around procurement-backed tile special orders.
- Updated inventory page CTAs toward Procurement and Manual GRN.
- Updated order document rendering to use structured quote and sales-order PDF status fields.
- Verified procurement, pending inward, dispatch, and manual GRN pages on desktop and procurement on mobile.

## Verification

Passed:

- `npm run db:generate`
- `npm run db:migrate:deploy`
- `npm run build:api`
- `npm run build:web`
- `git diff --check`
- `API_URL=http://localhost:4000/graphql WEB_URL=http://localhost:3002 node scripts/e2e-lead-intent-order-smoke.mjs`
- `API_URL=http://localhost:4000/graphql WEB_URL=http://localhost:3002 node scripts/e2e-quote-area-notification-smoke.mjs`
- `API_URL=http://localhost:4000/graphql WEB_URL=http://localhost:3002 node scripts/e2e-retail-flow-smoke.mjs`
- Procurement GraphQL smoke covering special-order demand, PO, GRN, reserved balance, and dispatch readiness.

Browser QA passed on:

- `/dashboard/procurement`
- `/dashboard/pending-inward`
- `/dashboard/dispatch`
- `/dashboard/inventory/inwards`
- Mobile viewport for `/dashboard/procurement`

No browser console errors or warnings were observed on the checked pages after the final clean web-dev restart.

## Operational note

The local PostgreSQL database already had tables but no Prisma migration history, so `prisma migrate deploy` initially returned `P3005`. I followed Prisma's baselining workflow and marked the existing synced migrations as applied, then reran `npm run db:migrate:deploy`; it now reports no pending migrations.

The local app is running at:

- Web: `http://localhost:3002`
- API: `http://localhost:4000/graphql`

## Remaining product boundaries

This patch completes the audit-critical stock-cycle path without overbuilding the stack. It does not add unrelated future modules such as accounting settlement automation, barcode-based warehouse scanning, or a full stock-count close workflow.

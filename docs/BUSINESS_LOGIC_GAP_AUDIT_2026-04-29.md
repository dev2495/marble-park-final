# Marble Park Business Logic And Feature Gap Audit

Date: 2026-04-29  
Scope: local server/backend GraphQL modules, Prisma schema, current frontend route map, live GraphQL smoke probe on `http://localhost:4000/graphql`, and existing feature research notes.

## Executive Summary

The app now has a useful foundation for a sanitaryware, faucet, sink, tile and bath retail ERP: product catalogue, image-backed products, quote builder/register/detail, CRM lead entry, users, inventory balances, inwards, dispatch board, role-aware shell, and seeded users/data.

It is not yet a complete end-to-end inventory management, CRM, dispatch and quote system. The main gap is that the schema is ahead of the business logic. Models such as `Reservation`, `AuditEvent`, `CatalogReviewTask`, `ImportBatch`, `ImportRow`, `SourceFile`, `AppSetting`, and `DispatchChallan` exist, but most are either not used by the active flows or lack complete UI/approval workflows.

The most important blockers before production use are:

1. RBAC/session enforcement is incomplete across products, customers, leads, quotes, dashboards, inventory, dispatch, imports, documents and search.
2. Quote confirmation creates a dispatch job, but does not reserve stock, consume stock, validate availability, or create item-level dispatch commitments.
3. Dispatch has jobs and challans in the backend, but no complete pack/challan/partial dispatch/delivery proof/inventory decrement flow.
4. Quote send/download exists through the web PDF route, but backend document generation is stale, branded incorrectly, and not wired to email/WhatsApp/send history.
5. Catalogue images are present, but the current assignment is not exact SKU-to-image proof. The data marks `exactSkuMatch: false`.
6. CRM is basic lead CRUD and stage movement, without activity timeline, follow-up completion, reminders, reassignment controls, lost reasons, customer detail, or conversion audit.
7. Inventory is a balance table plus manual adjustments. It lacks vendor purchasing, batch/location, stocktake, reorder, reservation, costing, and approval controls.
8. Audit logging models exist but are not written by the business mutations.
9. There is no automated regression suite for the business flows.

## Current Runtime Evidence

Live unauthenticated GraphQL probe returned business data without a token:

- `productStats`: 7,172 active products, 6 categories, 5 brands.
- `ownerDashboard`: 10 leads, 7 quotes, 5 customers, 8 users, quote value INR 272,110, image coverage 100 percent.
- `quotes`: quote line items, customer data, owner data, line media.
- `dispatchJobs`: pending job with customer details.

This proves that current server data exists, but also proves broad unauthenticated read access.

Current product category counts from the live probe:

| Category | Count |
| --- | ---: |
| Faucets & Showers | 3,157 |
| Sanitaryware | 1,568 |
| Catalogue Products | 1,328 |
| Accessories | 641 |
| Kitchen Sinks | 366 |
| Tiles | 112 |

Current page routes found under `apps/web/src/app`:

| Area | Current pages |
| --- | --- |
| Public/auth | `/`, `/login` |
| Dashboard | `/dashboard` |
| Catalogue | `/dashboard/products` |
| Inventory | `/dashboard/inventory`, `/dashboard/inventory/inwards` |
| Sales/CRM | `/dashboard/sales`, `/dashboard/leads`, `/dashboard/leads/new`, `/dashboard/customers` |
| Quotes | `/dashboard/quotes`, `/dashboard/quotes/new`, `/dashboard/quotes/[id]`, `/api/pdf/quote/[id]` |
| Dispatch | `/dashboard/dispatch` |
| Admin | `/dashboard/users` |

## P0 Blockers

These are required before calling the system production-ready.

### 1. RBAC And Data Access Is Incomplete

Evidence:

- `UsersResolver` protects list/create/update/delete with `requireRoles`, but `user(id)` is not guarded.
- Products, customers, leads, quotes, inventory, dispatch, imports, documents, dashboards and search resolvers do not consistently call `getSessionUser` or `requireRoles`.
- A live unauthenticated query returned quote, customer, dashboard and dispatch data.

Business impact:

- Any caller with GraphQL access can read sales, customer, quote and dispatch data.
- Any caller can potentially mutate products, customers, leads, inventory, quotes, imports and dispatch.
- Role landing pages and frontend role switch do not protect data unless backend enforces role rules.

Required fix:

- Add global GraphQL auth guard or resolver-level guard.
- Define role matrix:
  - `admin`: all modules and settings.
  - `owner`: all reports, users except admin takeover, approvals, audit.
  - `sales_manager`: team leads, quotes, approvals within threshold, customer assignment.
  - `sales`: own leads/customers/quotes, catalogue read, quote create, no arbitrary ownerId.
  - `inventory_manager`: inventory/products/imports/inwards/stock adjustments, no quote price edits.
  - `dispatch_ops`: dispatch jobs/challans/proof only, limited customer read.
- Enforce owner-scoped filters server-side. Do not rely on frontend `ownerId` variables.
- Add tests proving unauthenticated access is rejected and role access is scoped.

### 2. Quote Lifecycle Does Not Enforce Business Rules

Evidence:

- `QuotesService.create` stores lines and creates an auto lead if needed.
- `QuotesService.update` only flips `approvalStatus` based on discount greater than 15 percent.
- `sendQuote` only sets `status = sent` and `sentAt`.
- `confirmQuote` only sets `status = confirmed` and creates one dispatch job.
- No reservation, stock check, approval gate, version immutability, activity log, or send channel is enforced.

Business impact:

- Sales can confirm quotes without owner approval.
- Quotes can be changed after send/confirmation without version control or customer acceptance history.
- Confirmed quote does not secure stock or trigger purchase planning.
- Quote status can jump to arbitrary allowed states without transition rules.

Required fix:

- Implement strict quote states:
  - `draft -> pending_approval -> approved -> sent -> customer_followup -> confirmed/won/lost/expired`.
- Reject sending if approval is pending.
- Lock sent/confirmed quote versions or create a new revision when edited.
- Calculate quote subtotal, discount, taxable, GST, margin and floor price validation on the server, not only frontend.
- Add quote approvals with approver, timestamp, reason, approval threshold from settings.
- Add activity events for create, edit, approve, send, confirm, lost.
- Create reservations on send or confirm based on business policy.

### 3. Inventory Is Not Connected To Sales, Dispatch Or Purchasing

Evidence:

- `InventoryBalance` has `onHand`, `reserved`, `available`, `damaged`, `hold`.
- `Reservation` model exists.
- `InventoryService.adjustQuantity` updates onHand/available/damaged and creates an `InventoryMovement`.
- Quote confirmation does not create reservations or update inventory.
- Dispatch status changes do not decrement stock.

Business impact:

- The app can sell unavailable items without warning.
- Confirmed quotes do not reduce available inventory.
- Dispatch delivery does not consume stock.
- `reserved` can become stale or manually wrong because business flows do not maintain it.
- Owner dashboards cannot trust stock availability.

Required fix:

- Implement item-level availability check for quote lines.
- Implement reservation service:
  - reserve on quote send or confirm.
  - release on quote lost/expired/cancelled.
  - convert reservation to dispatch allocation.
- Recalculate balance invariant in transaction:
  - `available = onHand - reserved - hold - damaged`.
- Prevent negative inventory unless explicit backorder/purchase-order policy is chosen.
- Create movement records for reserve, release, dispatch, return, damage, stocktake and adjustment.
- Add inventory audit and approval for manual adjustments.

### 4. Dispatch Flow Is Not A Complete Retail Dispatch System

Evidence:

- `DispatchJob` is created once per confirmed quote.
- `DispatchChallan` model exists and service can create challans.
- Frontend dispatch page only shows a status board of jobs.
- No frontend for challan creation, line picking, packing, partial quantities, proof upload, or challan PDF.
- Status update does not change inventory.

Business impact:

- Dispatch cannot reliably pick exact SKUs/quantities from a quote.
- Partial dispatch is not supported properly.
- Vehicle/driver/transporter details are not captured in the visible flow.
- Delivery proof and site confirmation are missing.
- Inventory remains unchanged after dispatch.

Required fix:

- Add dispatch job detail page.
- Add item-level pack screen with quoted qty, reserved qty, packed qty, dispatch qty, balance qty.
- Add challan generation page and PDF route.
- Add statuses:
  - `pending_allocation`, `reserved`, `packed`, `challan_ready`, `dispatched`, `delivered`, `partially_delivered`, `cancelled`.
- Support multiple challans per quote/job for partial dispatch.
- On challan dispatch or delivery, create inventory movement and reduce reserved/onHand.
- Add proof uploads: signed challan photo, delivery photo, receiver name, timestamp.

### 5. Catalogue Images Are Not Exact SKU-Proven

Evidence:

- Live quote lines contain media with `source: pdf-catalogue-extract` and `exactSkuMatch: false`.
- Image extraction created usable images and gives 100 percent media coverage, but coverage is not proof that each SKU has its correct image.

Business impact:

- Quotes may show the wrong product image for some items.
- Customer-facing PDF/catalogue confidence is not production-grade without SKU-image verification.
- Imported image provenance is not reviewable from UI.

Required fix:

- Use `CatalogReviewTask` as a real review queue.
- Store source PDF, page, extracted image, detected text, detected SKU, mapped product, confidence.
- Add UI for human review and remap image to SKU.
- Add product detail provenance section.
- Split metrics:
  - image coverage.
  - exact SKU match coverage.
  - reviewed image coverage.

### 6. Backend Document/PDF Service Is Stale And Incorrect

Evidence:

- Web route `/api/pdf/quote/[id]` exists and renders PDF using a Node script.
- Backend `DocumentsService.generateQuotePdf` returns HTML buffer, not PDF.
- Backend document template still says `SHIVDHARA`, includes stale address/GST placeholders, and calculates line totals from `quantity/rate` while current quote lines also use `qty/price/sellPrice`.
- `DocumentsResolver.DocumentOutput` only declares `id`, while mutations return `{ data, contentType }` or `{ messageId, success }`.

Business impact:

- GraphQL document generation contract is broken/misleading.
- Email send can mark a quote as sent without attaching the correct PDF or changing status consistently.
- Customer-facing documents risk wrong branding and wrong totals.

Required fix:

- Replace backend document service with the same PDF renderer used by web route, or centralize PDF rendering in one service.
- Use `AppSetting` for company name, GSTIN, address, phone, email, terms, bank details.
- Return typed GraphQL outputs for PDF and email.
- Attach generated PDF to quote email/WhatsApp send.
- Store document events and delivery status.

### 7. Import Flow Is Not Safe For Catalogue Master Data

Evidence:

- Excel import reads first worksheet and directly updates/creates products row by row.
- PDF import tries OpenAI extraction or a simple regex heuristic.
- `ImportBatch`, `ImportRow`, `SourceFile` models exist but are not fully used in the service shown.
- No review/approval UI exists for imported rows before product master changes.

Business impact:

- Bad catalogue parse can overwrite product prices immediately.
- Brand-specific price lists with different column names can import incorrectly.
- No rollback, diff, duplicate resolution, or row-level error review.

Required fix:

- Upload files into `SourceFile`.
- Parse into `ImportBatch` and `ImportRow` staging tables.
- Show review UI with before/after product diff.
- Require approval before applying to `Product`.
- Detect duplicate SKUs, changed MRP, category changes, deleted SKUs, new SKUs.
- Keep import history and rollback file-level changes.

## P1 Major Product Gaps

### CRM And Sales Desk

Current state:

- Leads exist with stages, expected value, owner, next action date.
- Sales desk exists with pipeline and recent quotes.
- New lead page exists.

Missing:

- Lead detail page.
- Customer detail page with timeline, sites, contacts, quotes, dispatches and payments.
- Activity logging for calls, WhatsApp, showroom visit, sample shown, quote sent, negotiation.
- Follow-up task completion/snooze/reassign UI.
- Lost reason and competitor/price reason capture.
- Lead assignment rules and manager reassignment.
- Duplicate customer/lead detection by mobile/email/site.
- Architect/designer/contractor relationship tracking.
- Sales target and performance metrics per user.

Required pages:

- `/dashboard/leads/[id]`
- `/dashboard/customers/[id]`
- `/dashboard/crm/tasks`
- `/dashboard/crm/activities`
- `/dashboard/sales/team` for manager/owner.

### Product Master And Catalogue

Current state:

- Catalogue grid is image-backed and searchable.
- Products have SKU, name, category, brand, finish, dimensions, sell price, floor price, tax class, media.

Missing:

- Product detail page.
- Product edit/create UI.
- Product image review/remap UI.
- Alternate/substitute products.
- Bundles/packages for full bathroom sets.
- Tile-specific fields: size, finish, series, shade, batch, boxes, sqft/box, pieces/box.
- Sanitaryware/faucet-specific fields: mounting, color, finish, flow, warranty, series.
- Brand/range/category masters.
- Price history and margin history.
- Active/discontinued replacement handling.

Required pages:

- `/dashboard/products/[id]`
- `/dashboard/products/new`
- `/dashboard/catalogue/review-images`
- `/dashboard/catalogue/imports`
- `/dashboard/catalogue/price-history`

### Inventory And Inwards

Current state:

- Inventory balance list exists.
- Inwards page exists.
- Manual adjust service exists.
- Inward batch model stores supplier, reference and JSON lines.

Missing:

- Vendor/supplier master.
- Purchase order and goods receipt note.
- Batch/location/bin tracking.
- Serial/batch/shade tracking for tiles and high-value sanitaryware.
- Stocktake/counting flow.
- Approval for adjustments and write-offs.
- Reorder levels and purchase recommendations.
- Landed cost and valuation.
- Returns from customer and returns to vendor.
- Damaged/hold release workflow.

Required pages:

- `/dashboard/inventory/products/[id]`
- `/dashboard/inventory/stocktake`
- `/dashboard/inventory/adjustments`
- `/dashboard/inventory/purchase-orders`
- `/dashboard/inventory/suppliers`
- `/dashboard/inventory/locations`

### Quotes And Commercial Controls

Current state:

- Quote builder, register, detail and PDF download exist.
- Quote line images are shown.
- Confirm creates dispatch job once.

Missing:

- Quote edit route after save.
- Quote version compare.
- Approval inbox.
- Margin/floor price guard.
- Terms and conditions selection.
- Payment schedule/advance requirement.
- Customer acceptance capture.
- Send via email/WhatsApp with delivery log.
- Export/share link with access control.
- Quote expiry job.
- Quote lost reason and competitor tracking.
- Multi-site/project sections.

Required pages:

- `/dashboard/quotes/[id]/edit`
- `/dashboard/quotes/approvals`
- `/dashboard/quotes/[id]/versions`
- `/dashboard/quotes/[id]/send`

### Dispatch And Fulfilment

Current state:

- Dispatch board exists.
- Backend can create challans but UI does not expose it completely.

Missing:

- Dispatch detail view.
- Item picking/packing.
- Partial dispatch against line balances.
- Printable delivery challan PDF.
- Transport details and proof upload UI.
- Delivery confirmation.
- Customer/site contact confirmation.
- Dispatch cancellation/return flow.
- Stock decrement integrated with dispatch event.

Required pages:

- `/dashboard/dispatch/[id]`
- `/dashboard/dispatch/[id]/pack`
- `/dashboard/dispatch/[id]/challans/new`
- `/dashboard/dispatch/challans/[id]`
- `/dashboard/dispatch/challans/[id]/pdf`

### Owner/Admin Analytics

Current state:

- Owner dashboard has headline counts, quote values, user performance and status breakdown.

Missing:

- Sales user conversion by stage and period.
- Follow-up overdue by user.
- Quote sent-to-confirmed conversion.
- Gross margin and discount leakage.
- Inventory ageing and dead stock.
- Out-of-stock quoted products.
- Dispatch SLA and delayed dispatch.
- Lead source performance.
- Brand/category performance.
- Import quality metrics.
- Exportable daily/weekly reports.

Required pages:

- `/dashboard/analytics/sales`
- `/dashboard/analytics/inventory`
- `/dashboard/analytics/dispatch`
- `/dashboard/analytics/imports`
- `/dashboard/reports`

## P2 Important Completeness Gaps

These can follow P0/P1 but should be in the roadmap for a serious retail ERP.

- GST invoice flow separate from quotation.
- Payment collection and receivables.
- Refund/credit note handling.
- Barcode/QR scanning for stock and dispatch.
- Mobile-first dispatch proof capture.
- Customer portal/shareable quote link.
- Notification center and reminders.
- File attachments on customer/lead/quote/dispatch.
- Data export/import templates.
- Backup/restore and data retention policy.
- Settings UI for company, taxes, prefixes, thresholds, terms, bank details.
- Audit log viewer.
- Background jobs for quote expiry, reminders and report emails.

## Module-by-Module Gap Table

| Module | Exists now | Main gaps | Priority |
| --- | --- | --- | --- |
| Auth/users | Login, sessions, seeded roles, guarded user list/create/update/delete | Missing global RBAC, unguarded modules, unguarded `user(id)`, no password reset UI, no audit | P0 |
| Products/catalogue | 7,172 products, images, category normalization, catalogue grid | No exact image review, no detail/edit pages, no category/brand masters, no product-specific attributes | P0/P1 |
| Imports | Excel/PDF parser service, image extraction script | No staging approval, no rollback, no row review, no source file UI, direct product mutation | P0/P1 |
| Customers | List/create basic customer | Missing GST/state/notes/tags persistence, detail page, contacts/sites, duplicate detection | P1 |
| Leads/CRM | Lead list, new lead, stage movement, sales desk | Missing activity timeline, task completion, reassignment, lost reason, customer journey | P1 |
| Quotes | Builder/register/detail/PDF route/send/confirm | Missing approval enforcement, version lock, stock reservation, send delivery log, edit route | P0/P1 |
| Inventory | Balances, manual adjustment, inwards page | Missing reservation integration, PO/vendor, stocktake, location/batch, valuation, adjustment approval | P0/P1 |
| Dispatch | Job board, backend challan creation | Missing job detail, pack/challan UI, partial dispatch, challan PDF, proof, stock decrement | P0/P1 |
| Dashboards | Owner/sales/inventory counts | Missing period filters, margin, SLA, overdue, ageing, exportable reports | P1 |
| Documents | Web quote PDF route works; backend email service exists | Backend PDF service stale/HTML-only, wrong brand, no typed outputs, no quote email attachment | P0 |
| Audit/settings | Models exist | No mutation writes, no viewer, no settings UI or setting-backed business rules | P0/P1 |
| Tests | Build scripts exist | No backend/frontend business regression tests found | P0 |

## Recommended Backend Build Order

### Phase 1: Security And Business Invariants

Acceptance criteria:

- All GraphQL operations require session unless explicitly public.
- Every resolver has role checks and server-side scoping.
- Tests prove sales users cannot read/edit other sales users' private leads/quotes.
- Manual GraphQL unauthenticated `ownerDashboard`, `quotes`, `dispatchJobs`, `customers`, `inventoryBalances` returns authentication errors.
- Audit events are created for create/update/delete/status changes.

Work items:

- Add auth guard/interceptor or resolver wrapper.
- Add `requireSession`, `requireRoles`, `requireOwnershipOrRoles` helpers.
- Add audit service and write calls to quote, lead, customer, inventory, dispatch, import and user mutations.
- Add typed GraphQL outputs instead of broad JSON where business data matters.

### Phase 2: Quote-to-Inventory-to-Dispatch Integrity

Acceptance criteria:

- Quote send/confirm validates approval and price/margin rules.
- Quote confirm creates reservations by product/quantity.
- Available stock changes when reservations are created/released.
- Dispatch challan reduces reserved/onHand through inventory movement.
- Partial dispatch keeps remaining balance open.
- Cancelling/lost quotes releases reservations.

Work items:

- Implement reservation service.
- Add stock check endpoint for quote lines.
- Add quote transition service.
- Add dispatch line model or structured line JSON with quantities and statuses.
- Add inventory movement types and invariants.

### Phase 3: Catalogue Import And Image Review

Acceptance criteria:

- Excel/PDF import creates a batch and rows, not direct product mutations.
- User reviews proposed changes before applying.
- Image review queue tracks exact SKU matches separately from generic image coverage.
- Product detail shows image/source provenance and import history.

Work items:

- Implement `SourceFile`, `ImportBatch`, `ImportRow`, `CatalogReviewTask` flows.
- Add import dashboard and review pages.
- Add apply/rollback logic.
- Add confidence and exact-match metrics.

### Phase 4: CRM, Customer And Sales Operations

Acceptance criteria:

- Each customer has a full timeline with leads, quotes, calls, follow-ups, dispatches and notes.
- Sales users have own queue; managers/owners can view team queues.
- Follow-up tasks can be completed, snoozed and reassigned.
- Lead lost/won reasons are captured.
- Owner dashboard shows user-wise conversion and overdue work.

Work items:

- Add customer detail, lead detail and task pages.
- Add activity service and follow-up task mutations.
- Add lead assignment controls.
- Add duplicate detection by mobile/email/site.

### Phase 5: Documents, Notifications, Reports

Acceptance criteria:

- Quote PDF and challan PDF use one consistent renderer and correct Marble Park settings.
- Sending quote attaches the exact PDF and stores delivery metadata.
- Notifications are generated for approvals, overdue follow-ups, dispatch events and low stock.
- Reports can be filtered by date/user/category/brand/status and exported.

Work items:

- Centralize PDF renderer.
- Add settings-backed company profile and terms.
- Add notification table/UI.
- Add report pages and CSV/PDF exports.

## Recommended Frontend Page Map For Full System

Add these pages beyond the current route map:

| Route | Purpose | Roles |
| --- | --- | --- |
| `/dashboard/products/[id]` | Product detail, stock, image provenance, alternates | all logged-in roles, scoped actions |
| `/dashboard/products/new` | Add product | admin, owner, inventory_manager |
| `/dashboard/catalogue/imports` | Import batches and file history | admin, owner, inventory_manager |
| `/dashboard/catalogue/review-images` | SKU-image mapping review | admin, owner, inventory_manager |
| `/dashboard/customers/[id]` | Customer 360 page | admin, owner, sales_manager, assigned sales |
| `/dashboard/leads/[id]` | Lead detail/timeline/tasks | admin, owner, sales_manager, assigned sales |
| `/dashboard/crm/tasks` | Follow-up task queue | sales roles, owner |
| `/dashboard/quotes/[id]/edit` | Edit quote draft/new version | sales roles, owner |
| `/dashboard/quotes/approvals` | Discount/floor-price approval inbox | owner, sales_manager |
| `/dashboard/dispatch/[id]` | Dispatch job detail | dispatch_ops, owner |
| `/dashboard/dispatch/[id]/pack` | Picking and packing | dispatch_ops, inventory_manager |
| `/dashboard/dispatch/challans/[id]` | Challan detail and proof | dispatch_ops, owner |
| `/dashboard/inventory/stocktake` | Count and reconcile stock | inventory_manager, owner |
| `/dashboard/inventory/purchase-orders` | Vendor PO/reorder | inventory_manager, owner |
| `/dashboard/settings` | Company, tax, prefixes, thresholds | admin, owner |
| `/dashboard/audit` | Audit log viewer | admin, owner |
| `/dashboard/analytics/sales` | Sales and user analytics | owner, sales_manager |
| `/dashboard/analytics/inventory` | Stock, ageing, reorder analytics | owner, inventory_manager |
| `/dashboard/analytics/dispatch` | Dispatch SLA and backlog analytics | owner, dispatch_ops |

## Data Model Additions Recommended

Existing schema can support a base, but these additions would make the ERP safer:

- `ProductCategory`, `Brand`, `ProductSeries`, `ProductAttribute` for better catalogue taxonomy.
- `CustomerContact` and `CustomerSite` for multi-site customers and architects/designers.
- `QuoteLine` table instead of only JSON lines, for reporting, reservations, partial dispatch and audit.
- `DispatchLine` table tied to quote lines and reservations.
- `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceipt`, `GoodsReceiptLine`.
- `StockLocation`, `StockLot`, `Stocktake`, `StocktakeLine`.
- `Payment`, `Invoice`, `CreditNote` if billing is in scope.
- `Notification`, `Attachment`, `ActivityEvent` or expand existing `Activity`.
- `AuditEvent` relation to user and standardized metadata.
- `SettingHistory` for critical setting changes.

## Testing Gaps

No app-level tests were found in the source tree, apart from dependency files under `node_modules`.

Required regression coverage:

- Auth/RBAC matrix for every resolver.
- Quote create/update/send/approve/confirm/lost transitions.
- Discount/floor-price approval logic.
- Reservation creation/release and stock balance invariant.
- Dispatch partial challan and inventory decrement.
- Import staging/review/apply/rollback.
- Customer duplicate detection.
- PDF generation with product images and GST totals.
- Frontend E2E for sales user, owner, inventory manager, dispatch ops and admin.

## Immediate Action Plan

1. Lock the server with RBAC first. This is the highest risk because unauthenticated GraphQL currently exposes business data.
2. Implement quote transition service and approval rules before adding more UI polish.
3. Connect quote confirmation to reservation and dispatch allocation.
4. Build dispatch detail/challan PDF/partial delivery flow.
5. Convert imports into a review queue and exact SKU image review workflow.
6. Add CRM detail/timeline/task pages.
7. Replace stale backend document service with the working PDF renderer and correct Marble Park settings.
8. Add regression tests for every business-critical transition.

## Bottom Line

The current app is a strong prototype/base with real data, catalogue images, quotes, sales desk and dispatch board. It is not yet a no-gap ERP. The next work should not be more single-page polish. It should harden the server around RBAC, inventory reservations, quote approvals, dispatch fulfilment, import review, audit logging and tests, then add the missing detail pages that make the workflows complete end to end.

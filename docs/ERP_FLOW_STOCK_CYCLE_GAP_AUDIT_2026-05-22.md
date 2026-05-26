# Marble Park ERP Flow + Stock Cycle Gap Audit

Date: 2026-05-22  
Repo: `/Users/devarshthakkar/local_repos/Marble Park final`  
Scope: current codebase review of CRM, catalogue, quote, sales order, inventory, inward, dispatch, imports, approvals, roles, dashboards, and operational completeness. This is a logic/feature audit, not a code patch.

## Executive verdict

The current app is a strong custom retail-ops prototype: it has role-aware login, product master, customers, leads, intents, quote generation, sales order conversion, inventory balances, reservations, partial dispatch, pending inward visibility, imports, notifications, and dashboards.

It is not yet a complete production ERP for a sanitaryware/tile retail store. The biggest gap is the stock lifecycle. The app can reserve and consume stock, but it does not yet model the full commercial chain from sales demand to vendor purchase order to expected inward to GRN to warehouse/location to allocation to dispatch to delivery proof to payment and returns.

The practical risk: sales can run, but operations will still depend on manual memory, WhatsApp, spreadsheets, and owner intervention for backorders, vendor ordering, stock reconciliation, payments, tile special orders, and dispatch completion.

## External benchmark used

Mature retail ERP/inventory tools separate the same business actions into explicit documents and queues:

- Odoo treats inventory as warehouse management, with warehouses, locations, location types, replenishment, receipts, deliveries, cycle counts, scrap, stock reports, valuation, and movement history. Odoo documentation describes warehouse locations as distinct storage areas and separate virtual locations for vendor/customer/inventory-loss/transit movements. Source: https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management.html
- Odoo replenishment distinguishes reordering rules from make-to-order. MTO creates procurement immediately after sales order confirmation; reordering rules generate or suggest purchase orders when forecasted stock falls below minimum. Source: https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment.html
- Odoo reordering rules include location, min quantity, max quantity, multiple quantity, unit, and purchase/RFQ generation. Source: https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase/products/reordering.html
- Lightspeed Retail has purchase orders with explicit states: open, ordered, check-in while receiving, received/added to inventory, and finished. Source: https://retail-support.lightspeedhq.com/hc/en-us/articles/15256357228187-Managing-purchase-orders
- Lightspeed purchase receiving supports partial receiving, barcode/vendor-ID/manual receiving, and only adds received items to inventory after check-in/add-to-inventory. Source: https://retail-support.lightspeedhq.com/hc/en-us/articles/8153229791131-Receiving-items-in-purchase-orders
- Lightspeed inventory counts are separate from manual stock changes, support barcode/printout/spreadsheet counting, and reconcile discrepancies while warning about stock that changed during the count. Source: https://retail-support.lightspeedhq.com/hc/en-us/articles/229129948-Performing-inventory-counts-in-Retail-POS
- Zoho Inventory separates shipments and packages, including shipment tracking, delivery marking, package slip/shipment order PDFs, customer notifications, and shipment templates. Source: https://www.zoho.com/in/inventory/help/sales-orders/shipments.html
- Zoho CRM positions CRM as separate modules and records for leads, contacts, accounts, deals, calls, tasks, meetings, reports, forecasts, lead assignment, scoring, blueprints, and workflow automation. Source: https://help.zoho.com/portal/en/kb/crm/sales-force-automation/sfa-in-zoho-crm/articles/sales-force-automation-sfa-in-zoho-crm

## Current architecture snapshot

### Core models present

Observed in `apps/api/prisma/schema.prisma`:

- CRM: `Customer`, `Lead`, `LeadIntent`, `FollowUpTask`, `Activity`.
- Catalogue/master: `Product`, `ProductCategory`, `ProductBrand`, `ProductFinish`, `TileSize`, `Vendor`.
- Quote/order: `Quote`, `Reservation`, `SalesOrder`.
- Stock/dispatch: `InventoryBalance`, `InventoryMovement`, `InventoryInwardBatch`, `DispatchJob`, `DispatchChallan`.
- Import/image review: `SourceFile`, `ImportBatch`, `ImportRow`, `CatalogReviewTask`.
- System/user: `User`, `Session`, `Notification`, `AuditEvent`, `AppSetting`, `PasswordResetToken`.

### Current intended app flow in code

Current intended flow appears to be:

1. Customer/lead created.
2. Lead intent captured with Product Master rows, except tile rows can be non-stock using tile code/size/uom/qty.
3. Office staff generates quote from intent.
4. Sales shares quote PDF and follows up.
5. Quote can be confirmed or converted into a sales order.
6. Available product rows become reserved; unavailable rows become backordered.
7. Dispatch queue shows ready rows versus pending inward rows.
8. Inward stock on a backordered product can auto-reserve and notify sales/dispatch.
9. Dispatch challan can be created for ready lines and dispatch consumes reserved stock.

This is directionally correct, but several parts are still weak or duplicated.

## What is right

### 1. Product Master is treated as the quoting source

`QuotesService.assertQuoteLines` requires every non-tile quote row to have an active `productId` from Product Master. This is correct because the quote should not be a free-text list. Tile rows are intentionally special because the business cannot maintain 5,000+ tile design SKUs with images.

Why this is good:

- Prevents accidental quotes for unknown sanitary/faucet/sink products.
- Keeps catalogue, quote, reservation, and dispatch tied to one SKU identity.
- Allows the tile exception to stay practical.

Remaining weakness:

- Product master category/brand/finish are still strings, not foreign keys to master tables.
- Tile code rows are not connected to a vendor order/purchase demand model.

### 2. Quote lines are area-aware and support priced/selection mode

Quote lines normalize `area` and `quoteImage`, and quote display mode can be `priced` or `selection`. This matches the showroom workflow where a single client quote is split by bath/kitchen/area and can be sent either as a selection summary or priced quotation.

Remaining weakness:

- Area/room/section is JSON inside quote lines, not a first-class `QuoteSection`/`QuoteLine` entity.
- Because lines are JSON, the app cannot reliably track per-line revision, approval, reservation, purchase, dispatch, delivery, or return without parsing blobs.

### 3. Reservations and backorders exist

When a sales order is created or quote confirmed, code creates `Reservation` records and updates `InventoryBalance`. Available stock is reserved; insufficient stock becomes `backordered`.

Why this is good:

- It prevents dispatch from blindly consuming unavailable stock.
- It creates the foundation for pending inward and sales notification.

Remaining weakness:

- Backorder is only a reservation state. It does not become a purchase order, vendor order, or expected receipt.
- There is no allocation priority if multiple sales orders wait for the same SKU.
- Reservation quantities can drift from `InventoryBalance.reserved` if operations fail or manual adjustments bypass expected flows.

### 4. Dispatch partially supports line-level dispatch

`dispatchQueue` computes line statuses: `ready`, `pending_inward`, `tile_special_order`, `invalid_product`, `fully_dispatched`, and `not_reserved`. `createChallan` validates selected lines, and `updateChallanStatus('dispatched')` consumes inventory.

Why this is good:

- Partial dispatch is required for showroom orders.
- Not all items need to be present before a challan is created.
- Dispatch can see blocked rows separately.

Remaining weakness:

- Dispatch job status can become delivered when one challan is delivered, even if other lines remain pending.
- No package/shipment entity exists.
- No proof-of-delivery requirements or customer acknowledgement flow exists beyond JSON `proof` on challan.
- Tile special-order rows are visible but do not have a real purchase/receive/dispatch conversion path.

### 5. Pending inward exists as an operational queue

`pendingInwardItems` surfaces backordered reservation rows and tile special-order rows. This is the right concept for “orders placed but goods not yet in store.”

Remaining weakness:

- It is derived from reservations/sales orders, not from actual vendor purchase orders.
- There is no vendor, PO number, expected date, ordered quantity, received quantity, or follow-up owner.
- No purchase workflow lets staff convert pending demand into vendor orders.

### 6. Low-stock thresholds exist

`InventoryBalance` has `lowStockThreshold` and `reorderPoint`, and `findLowStock` compares available stock against those fields.

Remaining weakness:

- `getStockSummary` and dashboard service still use hard-coded `available < 5`, so low-stock counts can disagree with the actual SKU policy.
- There is no reorder quantity, preferred vendor, lead time, minimum order multiple, or purchase suggestion.

### 7. Import pipeline is more than a direct upload

PDF/Excel imports stage rows, can detect missing master fields, create import batches, require review/approval, and then apply rows to Product Master. PDF spatial extractor attempts image pairing.

Why this is good:

- Uploads should not directly pollute live catalogue.
- Images and extracted rows need review before approval.

Remaining weakness:

- Heavy PDF extraction is synchronous and can make the app slow or fail on production dynos.
- Image persistence depends on local filesystem paths/environment variables; on Railway, this needs a mounted volume or external object storage or images can disappear.
- No rollback/versioning/diff preview after applying an import.
- Import does not create vendor price list history.

## Critical flow gaps

### P0. Confirm quote and create sales order are two overlapping commands

Current code has both:

- `confirmQuote(id)` marks a quote confirmed, creates reservations, and opens dispatch job.
- `createSalesOrderFromQuote(input)` also creates reservations/job, creates `SalesOrder`, stores document URLs, sets quote confirmed, updates lead won, and notifies dispatch/sales/owner.

Problem:

- A quote can become “confirmed” and dispatch-ready without a sales order or payment mode.
- The UI still exposes confirm actions in quote list/detail, separate from sales order conversion.
- This violates the required business flow: final customer confirmation should create the sales order with cash/credit details, reserve stock, produce sales order PDF, and then open dispatch.

Business risk:

- Dispatch can start from a confirmed quote without payment/cash-credit classification.
- Owner cash/credit reports miss confirmed demand.
- Sales order PDF can be missing even though dispatch sees the job.

Required fix:

- Make one canonical action: `convertQuoteToSalesOrder`.
- Remove or restrict standalone `confirmQuote` from UI.
- If `confirmQuote` remains internally, it should not open dispatch and should not reserve stock unless it creates/links a SalesOrder.
- Sales order creation must be idempotent, transactional, and always generate/stash quote + order PDF URLs.

### P0. Stock cycle lacks Purchase Order / Procurement Order

Current pending inward is only “reservation is backordered.” There is no vendor purchase order, purchase line, expected receipt, vendor confirmation, ETA, or ordered status.

What a complete flow needs:

1. Sales order creates demand.
2. Unavailable stock creates purchase demand/backorder lines.
3. Staff groups demand by vendor/brand/SKU and creates purchase order.
4. Purchase order has statuses: draft, sent/ordered, partial received, received, cancelled, closed.
5. PO lines track ordered quantity, received quantity, cancelled quantity, expected date, vendor price, vendor SKU, notes.
6. GRN receives against PO lines, not directly against product balance.
7. Receiving a PO line updates stock and auto-allocates to waiting reservations by priority.

Business risk:

- Owner cannot know which customer orders are actually ordered from vendor.
- Sales cannot answer customer ETA accurately.
- Inventory inward can be posted without proving it belongs to the pending customer/order.
- Backorders become a list, not an accountable procurement process.

### P0. Inwards page is mixing GRN with all stock movements

The current `dashboard/inventory/inwards` page supports inward, outward, reserve, release, damage, and physical adjustment. The page text even says “Receive, reserve, consume and correct stock.”

Problem:

- GRN/inward should be vendor receipt only.
- Reserve should happen from sales order conversion.
- Consume should happen from dispatch.
- Release reserve should happen from cancellation/lost/return/manager action.
- Damage/adjustment should be a controlled inventory action, ideally with reason and approval/audit.

Business risk:

- Staff can manually manipulate stock lifecycle outside the sales/dispatch flow.
- It becomes hard to answer: did this quantity come from vendor receipt, customer dispatch, damage, cancellation, or stock count?

Required module split:

- GRN / Receive Stock: receive against PO or manual vendor receipt with supplier/challan/bill.
- Inventory Control: dashboard for low stock, reserved stock, available, damaged, on-hold.
- Stock Adjustments: physical count adjustment, damage, reserve release, write-off, manager approval.
- Stock Movement History: immutable audit trail.

### P0. SalesOrder line model is JSON, not operational lines

`SalesOrder.lines`, `Quote.lines`, `DispatchChallan.lines`, and `LeadIntent.rows` are JSON. This was fast to build, but it blocks production-grade operations.

Missing first-class entities:

- `QuoteLine`
- `SalesOrderLine`
- `ReservationLine` or allocation table
- `PurchaseDemandLine`
- `PurchaseOrderLine`
- `ReceiptLine`
- `DispatchLine`
- `ReturnLine`

Business risk:

- Cannot reliably calculate exact line lifecycle.
- Cannot show one line as pending inward, another as partially dispatched, another returned, another damaged.
- Cannot enforce uniqueness/idempotency per line.
- Analytics and audit require parsing mutable JSON.

Required fix:

- Keep JSON for display snapshots if needed, but add normalized line tables for operations.

### P0. Sales order PDF generation is not guaranteed

Sales order stores `documents.salesOrderPdfUrl`, but actual PDF generation can fail at request time, as the client screenshot showed “Error generating sales order PDF.”

Problem:

- The URL is stored, but not necessarily a generated durable document.
- There is no `Document` table with generation status, error, retry count, file path, storage key, generatedBy, generatedAt.

Business risk:

- Staff confirms sales order but cannot forward the official sales order PDF.
- Dispatch/customer-facing documents fail after the transaction is already created.

Required fix:

- Add document generation job/entity.
- Generate or verify sales order PDF inside/order-after transaction and show status: pending, generated, failed, retry.
- Store PDF in durable object storage or mounted volume.

### P0. New user create/login has schema/UI mismatch risk

Current resolver `CreateUserInput` exposes only `name`, `email`, `password`, `role`, `phone`. The service supports `avatarUrl` and `bio`, but the create resolver input does not. If the deployed frontend sends `avatarUrl`/`bio`, GraphQL rejects the mutation.

Business risk:

- Admin creates user, sees confusing “created”/error state, and the user may not be able to log in.
- Multi-user onboarding fails during client testing.

Required fix:

- Align GraphQL CreateUserInput, UpdateUserInput, service input, and UI fields.
- Add user status: invited, active, disabled; passwordChangedAt; lastLoginAt.
- Make delete a disable/archive, not hard delete.

## Stock cycle audit in detail

### Current stock states

At product level, `InventoryBalance` tracks:

- `onHand`
- `available`
- `reserved`
- `damaged`
- `hold`
- `lowStockThreshold`
- `reorderPoint`

This is a useful simple stock ledger, but it is incomplete for ERP operations.

### Missing stock dimensions

A complete stock model should include:

- Warehouse / showroom / godown.
- Location / shelf / rack / bin.
- Vendor / supplier source.
- PO number and receipt reference.
- Batch/lot/serial where needed.
- Cost rate / landed cost / valuation layer.
- Reserved for which sales order line.
- Hold reason.
- Damaged/scrap reason and approval.
- Transfer/in-transit quantities.
- Expected inward quantities.
- Ordered but not received quantities.
- Returned quantities.

### Recommended stock quantity buckets

For each product/location:

- `onHand`: physically in the business.
- `available`: can be sold/dispatched now.
- `reserved`: committed to sales orders.
- `allocated`: picked/packed but not dispatched.
- `damaged`: physically present but not sellable.
- `hold`: owner/quality hold.
- `incomingOrdered`: PO confirmed, not received.
- `incomingPendingReceipt`: vendor shipped/expected at GRN.
- `backorderedCustomerDemand`: sold/confirmed but not available.
- `inTransit`: between locations or out for delivery before delivered.

Current app has only the first five-ish buckets.

### Required stock lifecycle

Recommended canonical lifecycle:

1. Product Master SKU created.
2. Reorder policy configured: preferred vendor, min, max, reorder point, reorder quantity, lead time, UOM.
3. Lead intent / quote reserves nothing yet.
4. Sales order confirmation validates lines and payment mode.
5. Available products reserve stock.
6. Short products create purchase demand/backorder lines.
7. Office/inventory creates Purchase Order from purchase demand.
8. Vendor confirms PO and expected date.
9. GRN receives stock against PO lines.
10. Receipt updates on-hand and allocates stock to oldest/priority reservations.
11. Sales and dispatch get notification: item arrived and is ready.
12. Dispatch creates package/challan only for ready lines.
13. Mark dispatched consumes reserved/allocated stock and creates shipment/challan PDF.
14. Mark delivered captures proof and closes dispatch line.
15. Fully delivered sales order closes; partial remains open.
16. Returns/damage/write-off/cancellation flow releases or reverses quantities.
17. Cycle count reconciles physical stock with system stock through approved adjustments.

## Feature gap matrix

| Area | Current state | Missing | Risk | Priority |
|---|---|---|---|---|
| Quote confirmation | Separate confirm and sales-order conversion | Single canonical quote-to-sales-order FSM | Dispatch without SO/payment/PDF | P0 |
| Purchase orders | No PO model | PO header/lines/status/vendor/ETA | Backorders unmanaged | P0 |
| GRN | Manual inward movement | Receive against PO/vendor challan/bill | No proof of source for stock | P0 |
| Pending inward | Derived from backordered reservations/tile rows | Purchase demand + vendor order tracking | Sales cannot promise ETA | P0 |
| Dispatch | Partial challan exists | Package/shipment/delivery proof/line completion | Job can look delivered too early | P0 |
| Sales order PDF | URL points to generator | Durable document generation status/storage/retry | Customer-facing docs fail | P0 |
| Payments | cash/credit + advance fields | Payment ledger, receipts, due dates, credit aging | Owner cannot reconcile cash/credit | P0/P1 |
| Stock locations | Product-level balance only | warehouse/location/bin/transit | Cannot manage real showroom/godown | P1 |
| Stocktake | Manual adjustment only | count sessions, variance, approval | Stock accuracy weak | P1 |
| Returns | Not modeled | return/RMA/replacement/refund flow | No reverse logistics | P1 |
| Product master | Masters exist but Product stores strings | FK relations and merge/rename governance | Master edits don't reliably update SKUs | P1 |
| Imports | Staged import exists | async jobs, rollback, source versioning | Slow/failure-prone catalogue uploads | P1 |
| Tiles | TileSize master exists | tile procurement/order/receipt/dispatch line flow | Tile special order remains manual | P0/P1 |
| CRM follow-up | Basic tasks/activity | structured calls, lost reasons, SLA, duplicate detection | Sales leakage | P1 |
| Dashboards | Role dashboards exist | operational drill-down consistency | Numbers can disagree | P1 |
| Low stock | threshold/reorderPoint fields | reorder quantity/vendor/lead time plus consistent counts | Cannot create purchase suggestions | P1 |
| Audit | AuditEvent exists | consistent audit on all sensitive mutations | User/admin changes less traceable | P1 |
| Performance | Some DataLoader work done | pagination, query splitting, async extraction | Slow clicks under real data | P0/P1 |

## CRM and sales flow gaps

### Lead and intent flow is directionally correct

The app supports lead creation with intent rows, office quote generation, follow-up task creation, and quote PDF notification.

Missing to feel like a full CRM suite:

- Lead assignment rules.
- Duplicate mobile/email detection.
- Structured lead source and campaign fields.
- Follow-up outcome types: call not answered, customer asked discount, site visit needed, architect pending, quote revised, lost to competitor, hold, budget mismatch.
- Activity types for call, WhatsApp, site visit, meeting, note, email, payment reminder.
- Next-action SLA and overdue escalation.
- Lead scoring or priority.
- Pipeline probability and expected close date.
- Lost/cancel reason taxonomy.
- Quote revision history with why/revised-by/customer-visible status.
- Customer consent/preferences for communication.
- Sales manager review queue for stale leads.

### Follow-up loop needs stronger state control

Current system can create another intent after follow-up, which is right. But it should enforce a customer journey:

- Lead new.
- Intent captured.
- Office quote generated.
- Sales follow-up due.
- Follow-up outcome recorded.
- Either new/revised intent, close lost, hold, or confirm quote.
- Confirm quote creates sales order.
- Lead remains won only after sales order, not only quote confirmed.

Current risk:

- Quote status can move without complete follow-up outcome.
- Lead can become won from sales order creation, but standalone quote confirmation can confuse pipeline.

## Quote and document gaps

What exists:

- Priced/selection display mode.
- Area grouping metadata.
- Quote PDF endpoint.
- Sales order PDF URL stored after order creation.
- Custom quote image per line.

What is missing:

- Durable document records.
- PDF generation status and retry.
- Customer acceptance record: acceptedBy, acceptedAt, signature/photo/WhatsApp confirmation/ref no.
- Terms versioning.
- Quote revision compare view.
- Discount approval threshold enforcement if discounts exceed policy.
- GST/tax breakdown at line level.
- Brand logo master integration in quote PDF should be driven by brand master assets.
- PDF templates should be centrally managed from settings, not hard-coded.

## Inventory and procurement gaps

### Need a procurement module

Add pages/entities for:

- Purchase Demand / Backorder Queue.
- Create Purchase Order from selected demand lines.
- Purchase Orders list.
- Purchase Order detail.
- Vendor confirmation and ETA.
- Partial receive / GRN against PO.
- Purchase order PDF/export.
- Vendor follow-up status.

This directly solves the “ordered for customer but not inward yet” problem.

### Need a real GRN page

GRN should capture:

- Vendor.
- PO number or “manual receipt without PO” reason.
- Supplier challan/bill number.
- Received date.
- Received by.
- Line SKU.
- Ordered qty.
- Received qty.
- Accepted qty.
- Damaged/rejected qty.
- Location/bin.
- Cost price.
- Attachments/photos.
- Auto-allocation result.

### Need inventory control page separate from GRN

Inventory control should show:

- Search SKU.
- On hand / available / reserved / damaged / hold / incoming / backordered.
- Reserve release actions.
- Mark damaged/scrap.
- Physical adjustment.
- Low-stock policy.
- Movement history.
- Linked sales orders and purchase orders.

## Dispatch gaps

Current dispatch is useful, but needs:

- Dispatch line table with ordered/reserved/packed/dispatched/delivered/returned quantities.
- Package entity: package number, box count, packed by, packed at, photos, remarks.
- Shipment entity: transporter, vehicle, driver, tracking, dispatch date, delivery date.
- Proof of delivery: signature/photo/name/mobile/time/GPS optional.
- Delivery status should be per package/line, not only job-level.
- Job status should aggregate from lines: pending, partly ready, ready, partial dispatched, dispatched, partial delivered, delivered, cancelled.
- Dispatch should not allow challan creation unless linked SalesOrder exists.
- Backordered/tile rows should show PO/ETA and cannot be dispatched until received/allocated.
- Return from customer should reverse delivered lines into available/damaged based on inspection.

## Tile-specific flow gaps

The tile strategy is right: do not maintain every design as Product Master image/SKU. Use tile intent rows with tile code, size, UOM, quantity.

But complete flow needs:

- `TileSize` master with name/code/uom/pcsPerBox already exists.
- Tile brand/vendor optional.
- Tile rate/price captured in intent/quote.
- Tile special-order demand line after sales order.
- Tile purchase order line to vendor.
- Tile receipt line with batch/shade/lot if required.
- Tile dispatch line once received.
- Stock not necessarily maintained for every design, but order lifecycle must be maintained.

Current risk:

- Tile rows are quoted and visible as special order, but their vendor order/receipt/dispatch tracking is still mostly manual.

## Master data gaps

Current masters exist:

- Category
- Brand
- Finish
- Tile size
- Vendor

Problems:

- Product stores category/brand/finish as strings; master edits do not cascade structurally.
- Master pages have been reported as not showing live data in some deployments; this must be tested and fixed before client testing.
- Vendor master is not connected to product preferred vendor, purchase orders, imports, or GRNs.
- Brand master should store logo, served/active flag, quote-display order, default warranty/terms.
- Category master should define inventory behavior: stock tracked, tile special-order, default UOM, default tax, quote section labels.
- Finish master should define display label/code and active status.

Required master governance:

- Master merge/rename tools.
- “Used by X products” counters.
- Prevent delete if in use; archive instead.
- Audit for changes.

## Role and approval gaps

Roles found across code:

- admin
- owner
- sales_manager
- sales
- office_staff
- inventory_manager
- dispatch_ops

Issues:

- One resolver uses `dispatch` instead of `dispatch_ops` for vendor query permissions. This can break dispatch-role access.
- Approval page currently focuses on quote/import/image approvals. But quotes are auto-approved in current logic, so owner approval dashboards may show stale/empty concepts.
- Need a role-permission matrix table or central constant. Right now permissions are spread across resolvers.

Recommended role landing pages:

- Admin: users, audit, system health, master data, all approvals.
- Owner: revenue, cash/credit, approval queues, purchase/backorder risk, low stock, sales performance.
- Sales manager: pipeline, sales users, follow-up aging, quote conversion, stale leads.
- Sales: leads, follow-ups, quote PDFs, customer order tracking, item arrival notifications.
- Office staff: intents, quote generation, sales order conversion, purchase demand handoff.
- Inventory manager: GRN, stock control, low stock, purchase receiving, adjustment approval.
- Dispatch ops: ready dispatch, packages, challans, delivery proof, pending inward view.

## Performance and “slow app” gap analysis

Likely causes from code shape:

- Many dashboard pages call broad GraphQL lists with JSON-heavy rows.
- Several list queries use fixed `take: 150`, `take: 200`, `take: 500`, or no cursor pagination.
- Quote/order/lead lines are JSON; every page parses and computes lifecycle client-side/server-side repeatedly.
- PDF import/extraction can be CPU-heavy and synchronous.
- Dashboard pages combine many counts and lists in one client render path.
- Images may be loaded from public paths without thumbnail variants, causing heavy catalogue pages.
- If local/production images are served from ephemeral disk or slow volume paths, image rendering can stall.

Recommended performance fixes:

- Cursor pagination for products, quotes, leads, inventory, movements, dispatch jobs.
- Server-side search indexes and limited fields for list pages.
- Separate “summary” queries from “detail” queries.
- Async job queue for PDF/image extraction.
- Thumbnail generation and responsive image sizes.
- Persisted/optimized PDF documents instead of on-demand heavy rendering.
- Avoid refetching full dashboards after every small mutation; update Apollo cache or refetch narrow queries.
- Add API timing logs and slow query logging.

## Reporting and analytics gaps

Current dashboards have useful headline metrics, but full owner reporting should include:

- Cash orders by day/week/month.
- Credit orders and aging.
- Advance collected and balance due.
- Sales user performance: leads, quotes, won, lost, conversion rate, revenue, overdue follow-ups.
- Product/category/brand sales report.
- Pending inward by customer/order/vendor/ETA.
- Dispatch backlog and aging.
- Low-stock and reorder suggestions.
- Stock valuation and dead stock.
- Import batches and catalogue coverage.
- Customer repeat orders and architect/designer referrals.
- Margin/floor-price exceptions.
- Adjustment/damage/write-off report.

## Accounting/payment gaps

Current `SalesOrder` has payment mode/status/advance/total. That is not enough for business control.

Needed:

- Payment records: amount, mode, reference, receivedBy, receivedAt, notes.
- Receipt number generation.
- Due balance calculation.
- Credit customer terms: credit limit, days, approval.
- Cash/UPI/bank transfer/check split.
- Refund/return payment handling.
- GST invoice link or export to accounting.
- Owner daily cash closing report.

## Data integrity gaps

High-risk areas:

- Number generation uses count + 1 for quote/order/challan style sequences; concurrent requests can collide.
- JSON line blobs can be mutated without preserving line-level history.
- User delete may be unsafe because users own leads/quotes/activities; disable/archive is safer.
- Inventory manual adjustment is powerful and should require reason/approval for large changes.
- Hard delete of business records should be avoided after transaction activity.
- Import application can update live products without clear before/after diff.

Recommended controls:

- Sequence table or DB sequence for quote/order/challan/PO/GRN numbers.
- Soft delete/archive for business entities.
- Audit event for every admin/stock/payment mutation.
- Optimistic concurrency/version field on critical documents.
- Idempotency keys for quote confirm/order creation/dispatch/PDF generation.

## Recommended target data model additions

### Stock/procurement

- `Warehouse`
- `StockLocation`
- `StockLedgerEntry`
- `StockBalanceByLocation`
- `PurchaseDemand`
- `PurchaseDemandLine`
- `PurchaseOrder`
- `PurchaseOrderLine`
- `GoodsReceiptNote`
- `GoodsReceiptLine`
- `StockCountSession`
- `StockCountLine`
- `StockAdjustmentApproval`
- `ProductVendor`
- `ReorderPolicy`

### Sales/quote/dispatch

- `QuoteSection`
- `QuoteLine`
- `SalesOrderLine`
- `SalesOrderDocument`
- `PaymentReceipt`
- `DispatchPackage`
- `DispatchLine`
- `Shipment`
- `DeliveryProof`
- `ReturnOrder`
- `ReturnLine`

### CRM

- `LeadSource`
- `LeadStageHistory`
- `LeadActivity`
- `FollowUpOutcome`
- `LostReason`
- `CommunicationLog`
- `SalesUserTarget`

### Documents/assets

- `DocumentJob`
- `FileAsset`
- `ProductImage`
- `BrandAsset`
- `ImportBatchVersion`

## Recommended pages/modules

### Must-have before client testing

- Sales order conversion page: one button/action for final confirmation with cash/credit/advance and generated PDFs.
- Pending inward / purchase demand page: customer order rows grouped by vendor/brand/SKU with create PO action.
- Purchase order page: create/send/track vendor orders.
- GRN page: receive against PO or manual vendor receipt.
- Inventory control page: low stock, reserved stock, damaged, adjustment, release reserve.
- Dispatch page: ready vs pending rows, partial challans, proof, line completion.
- User management page: create, edit, disable, reset password, role, last login, no schema mismatch.
- Master data hub: live categories/brands/finishes/tile sizes/vendors with counts and edit/archive.
- Document center or order detail document panel: quote PDF, sales order PDF, challan PDFs with generation status.

### Should-have soon after

- Stock count/cycle count page.
- Returns/damage/refund page.
- Payment receipts and credit aging page.
- Sales performance dashboard.
- Vendor performance dashboard.
- Import job monitor.
- Audit log export.

## Suggested phased roadmap

### Phase 1: Make the current system operationally safe

Goal: client can run real testing without breaking stock/order truth.

- Merge quote confirm and sales order conversion into one canonical flow.
- Block dispatch unless a SalesOrder exists.
- Ensure order PDF generation is durable and visible.
- Fix user create/login schema mismatch.
- Split GRN from inventory adjustment actions.
- Add purchase demand page backed by sales-order shortages.
- Add PO/GRN minimum viable model.
- Make pending inward rows show vendor/order/ETA/status.
- Fix role permission constants and sidebar access.
- Make low-stock summary use reorderPoint/lowStockThreshold everywhere.
- Add pagination to large list pages.

### Phase 2: Make inventory reliable

- Warehouse/location/bin support.
- Stock ledger and count sessions.
- Adjustment approval and damage workflow.
- Product-vendor/reorder policies.
- Auto-allocation of received stock to oldest/priority backorders.
- Movement history by SKU/customer/order/vendor.

### Phase 3: Make CRM mature

- Structured follow-up outcomes.
- Lead scoring and stale lead queues.
- Duplicate detection.
- Communication logs.
- Sales manager coaching reports.
- Lost reason analytics.

### Phase 4: Make finance/reporting complete

- Payment receipts.
- Credit aging.
- GST/tax invoice export.
- Cash closing.
- Margin reports.
- Product/category/brand profitability.

## E2E acceptance scenarios before calling it “complete”

### Scenario 1: Stocked product cash order

1. Create Product Master SKU with image.
2. Add stock via GRN.
3. Create lead and intent from product.
4. Office creates quote with price.
5. Sales sends PDF and records follow-up.
6. Customer confirms.
7. Office converts quote to cash sales order with advance/full payment.
8. System reserves stock and generates sales order PDF.
9. Dispatch creates challan for the ready line.
10. Dispatch marks shipped/delivered.
11. Inventory on-hand/reserved/available updates correctly.
12. Owner cash report shows order/payment.
13. Lead timeline shows every step.

### Scenario 2: Mixed stocked and backordered product

1. Quote has one available SKU and one unavailable SKU.
2. Sales order creates reserved line for available SKU and purchase demand for unavailable SKU.
3. Dispatch can ship only available SKU.
4. Pending inward shows unavailable SKU with customer/order/sales owner.
5. Purchase order is created to vendor.
6. GRN receives the SKU.
7. System auto-allocates to original customer order.
8. Sales and dispatch get notifications.
9. Dispatch ships remaining line.
10. Sales order closes only after all lines delivered.

### Scenario 3: Tile special order

1. Lead intent captures tile code, size, uom box/pc, quantity, pcs per box, price.
2. Office creates quote.
3. Customer confirms sales order.
4. Tile line becomes purchase demand, not inventory reservation.
5. Purchase order to vendor tracks ETA.
6. GRN receives tile order.
7. Dispatch can ship tile once received.
8. Lead/order timeline shows tile lifecycle.

### Scenario 4: Stock count correction

1. Inventory manager opens count session.
2. Counts selected category/brand/SKU list.
3. System shows variance against book stock.
4. Owner/admin approves variance if above threshold.
5. Adjustment ledger entry is posted.
6. Movement history shows count session reference.

### Scenario 5: User and role testing

1. Admin creates sales, office, inventory, dispatch, owner users.
2. Each can log in concurrently.
3. Each lands on their role dashboard.
4. Each sees only allowed modules.
5. Admin/owner can disable/reset password.
6. Disabled user cannot log in.

## Final assessment

The current system is not “wrong”; it is incomplete in the exact place retail ERPs are hardest: stock lifecycle truth. It currently manages stock as a balance plus manual movements, with reservations/backorders layered on top. A production-ready retail ERP needs document-driven inventory: sales orders, purchase demands, purchase orders, GRNs, allocations, packages, shipments, delivery proofs, payments, returns, and count adjustments.

Most important next step is not UI polish. It is to lock the business state machine:

`Lead -> Intent -> Quote -> Sales Order -> Reservation/Purchase Demand -> PO -> GRN -> Allocation -> Dispatch Challan/Shipment -> Delivery -> Payment/Closure -> Return/Adjustment if needed`

Until this is enforced in code and data tables, the app will continue to feel “almost there” but operationally incomplete.

## Appendix: code evidence checked

This audit was based on current source review, including these concrete code areas:

- `apps/api/prisma/schema.prisma`: `InventoryBalance` is product-level only with `productId @unique`, `onHand`, `reserved`, `available`, `damaged`, `hold`, `lowStockThreshold`, and `reorderPoint`; no warehouse/location/bin/PO/GRN line tables exist.
- `apps/api/prisma/schema.prisma`: `Product` stores `category`, `brand`, and `finish` as strings while master tables exist separately.
- `apps/api/prisma/schema.prisma`: `Quote.lines`, `SalesOrder.lines`, `DispatchChallan.lines`, and `LeadIntent.rows` are JSON, not normalized operational line tables.
- `apps/api/src/modules/quotes/quotes.service.ts`: `confirmQuote` creates reservations and dispatch job without creating a `SalesOrder`.
- `apps/api/src/modules/quotes/quotes.service.ts`: `createSalesOrderFromQuote` separately creates reservations/job, sales order, documents, and notifications. This duplicates part of `confirmQuote`.
- `apps/api/src/modules/quotes/quotes.service.ts`: `assertQuoteLines` correctly blocks empty/non-product quote lines and permits tile rows only with tile details.
- `apps/api/src/modules/inventory/inventory.service.ts`: `pendingInwardItems` is derived from backordered reservations and tile rows, not actual vendor purchase orders.
- `apps/api/src/modules/inventory/inventory.service.ts`: `adjustQuantity` allows manual inward/outward/reserve/release/damage/adjustment against balances.
- `apps/api/src/modules/inventory/inventory.service.ts`: `findLowStock` uses configured threshold/reorderPoint, but `getStockSummary` still counts low stock using hard-coded `available < 5`.
- `apps/api/src/modules/dispatch/dispatch.service.ts`: dispatch queue computes ready/pending/tile/invalid statuses, but challans and job status are not backed by normalized dispatch lines/packages/shipments.
- `apps/api/src/modules/dispatch/dispatch.service.ts`: `updateChallanStatus('delivered')` updates the whole dispatch job to delivered from one challan path, which is risky for partial shipments.
- `apps/api/src/modules/imports/imports.service.ts`: PDF import is staged and can extract images, but extraction is synchronous and image storage depends on filesystem/public URL environment.
- `apps/api/src/modules/users/users.resolver.ts`: `CreateUserInput` exposes only name/email/password/role/phone; profile fields are exposed elsewhere, so frontend create-user payloads must match this exactly or GraphQL rejects them.
- `apps/api/src/modules/system/system.resolver.ts`: vendor query permission includes `dispatch`, while the app role used elsewhere is `dispatch_ops`.
- `apps/web/src/app/dashboard/inventory/inwards/page.tsx`: the inwards page currently contains multiple stock movement types, not only GRN/vendor receiving.

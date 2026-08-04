# Marble Park Operations Control Tower Review

**Scope:** quotation pricing signal, Sales Order register, reserved/pending dispatch, inventory command center, and label selection usability.

**Date:** 4 August 2026
**Mode:** read-only review and interactive HTML mockup. No application, database, or deployment changes were made.

## Executive conclusion

The stock lifecycle is materially present in the backend, but the main operational pages do not expose it as one coherent work queue. Sales Orders currently shows commercial totals and PDF links. Inventory currently shows a product-level balance. Dispatch has the richer line-level truth, but users must leave the order register and mentally reconcile multiple pages.

The recommended solution is not another dashboard. It is four connected work surfaces backed by shared pricing rules and server-side operational read models:

1. **Quote Pricing Workbench** for basis-aware MRP, List Rate, negotiated rate, GST, saving, and pricing readiness.
2. **Sales Order Control Tower** for order promise, payment, fulfilment, and exception ownership.
3. **Reserved & Dispatch Balance** for lot/location allocation and the exact quantity still to pick, pack, dispatch, or procure.
4. **Inventory Command Center** for product, location, lot, cost, selling-price completeness, inbound supply, and lifecycle drill-down.

The complete implementation contract is in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

## MRP vs List Price

These are separate commercial facts and must not share a field.

| Value | Meaning in Marble Park | Source | Tax treatment |
|---|---|---|---|
| **MRP** | Maximum price for one active quotation pricing unit | Entered or explicitly confirmed by the quote creator | Tax-inclusive |
| **List Rate** | Marble Park's normal pre-discount selling rate | `Product.sellPrice`, converted to the selected PC/BOX/AREA basis | Pre-GST |
| **Net / Negotiated Rate** | Actual customer offer after line discount or manual override | Quote line | Pre-GST |
| **Final unit payable** | Amount charged for one pricing unit after quote discount and tax | Shared pricing engine | Tax-inclusive for GST quotes |

The planned mandatory rule is: every new or revised quote line needs `MRP > 0` before confirm, approval, PDF, share, or Sales Order conversion. Save Draft remains available with a visible `INCOMPLETE_PRICING` state so sales work is not lost.

MRP must be labelled by basis (`MRP / PC`, `MRP / BOX`, or `MRP / SQ FT`). A rate-basis change invalidates an unconfirmed MRP unless the Product Master conversion is deterministic and the user confirms the converted value.

Today the new-quote flow initializes List Rate from `Product.sellPrice`, persists it as `QuoteLine.listPrice`, and the unlocked quote editor can still change that field. The proposed control makes the snapshot read-only in normal quote editing; changing the standard rate happens in Product Master or through an explicit audited refresh/override action.

For applicable pre-packaged goods, MRP is a tax-inclusive maximum retail sale price under Legal Metrology requirements. Requiring it on every Marble Park quote line is a broader ERP business control; loose tiles, project quantities, custom items, and non-prepackaged goods should receive client tax/legal sign-off before rollout.

## Why List Rate Is Zero

The quote editor is rendering the persisted data correctly. The affected SKUs have no Product Master selling price.

Live read-only production evidence:

| SKU | Product sell price | Product floor price | Quote list price | Quote negotiated rate |
|---|---:|---:|---:|---:|
| `KUS-WHT-35953BIUFSMPM` | 0 | 0 | 0 | 3,234 |
| `ALD-CHR-083R` | 0 | 0 | 0 | 2,230 |
| `HSH-CHR-1657` | 0 | 0 | 0 | 3,245 |

The quote normalizer intentionally takes list price from `Product.sellPrice`, while the negotiated rate is stored independently in `QuoteLine.unitPrice`. Therefore the editor shows a valid negotiated amount next to a missing list-price baseline.

### Business risk

- A 15% discount appears even though the list price is zero, so the displayed discount is not mathematically connected to the negotiated amount.
- Floor-price and margin checks cannot be trusted for these lines.
- Quote revisions can preserve a commercial number without preserving why that number was approved.
- Inventory retail valuation is understated for stock whose `sellPrice` is zero.

### Required correction in the implementation phase

- Add a **Price Completion** queue for active SKUs with missing selling price, floor price, or cost.
- Support inline edits and the existing Excel flow, with validation and a preview before apply.
- Display **List price missing** instead of `0` in quote editing.
- Disable percentage-discount derivation when list price is missing; require a negotiated-rate reason and approval policy.
- Freeze list price, negotiated rate, discount, tax treatment, and approval evidence in each quote version.

## Live Operational Snapshot

Read-only aggregate snapshot from the AWS database on 4 August 2026:

| Metric | Current value | Interpretation |
|---|---:|---|
| Products | 721 | 715 active |
| Active products with zero sell price | 645 | 90.2% of active Product Master lacks list price |
| Inventory on hand | 1,853 units | Across 186 active lots and one stock location |
| Available / reserved | 1,842 / 11 | Reserved stock exists but is not visible on the current order register |
| Active sales orders | 6 | Total order value ₹1,28,966.70 |
| Sales-order line quantities | 26 ordered | 11 ready/reserved, 11 pending inward, 4 delivered |
| Open purchase-demand shortage | 11 units | Four purchase-demand lines |
| Cost valuation | ₹0 | Lot and product costs are missing for stocked items |
| Available-stock retail value | ₹4,21,500 | Incomplete because 164 stocked SKUs have zero sell price |
| Low-stock signals | 626 | Default threshold creates noise before thresholds are calibrated |
| Display samples | 0 | Explains the empty Display selector on Labels & Scan |

The figures prove that **price completeness, cost completeness, and threshold calibration are release controls**, not cosmetic cleanup.

## Reviewed User Flows

1. Open a quote with active Product Master items and compare list price, negotiated rate, discount, and total.
2. Open Sales Orders and find an order by date, payment mode, customer, owner, fulfilment state, and promised date.
3. Determine which quantities are ordered, reserved, backordered, picked, packed, dispatched, delivered, returned, or cancelled.
4. Identify every order line blocked by pending inward and open the related purchase demand or PO.
5. Create a pick list from lot- and location-specific reservations without over-picking.
6. Partially dispatch an order and retain the remaining order-line balance.
7. Open inventory by product, category, brand, finish, location, lot, quality state, and stock state.
8. Reconcile product-level balance to lot/location balances and ledger movements.
9. Distinguish accounting cost value from retail selling value.
10. Generate labels from a searchable lot or display-sample selector.

## Findings

### P0 - Pricing and valuation foundations are incomplete

`645/715` active products have zero selling price. `166` stocked products have zero product cost, and current lot cost valuation is zero. This directly affects quote clarity, price approvals, PO/GRN fallback cost, inventory valuation, and management reporting.

**Resolution:** treat `sellPrice`, optional `floorPrice`, and cost provenance as separate completeness states. Product Master can remain creatable without prices, but quotation discounting, margin approval, and valuation must visibly declare the missing source.

### P0 - The Sales Order page is not an operational control surface

The current API filters only by payment mode and relative date, returns up to 200 orders, and provides no server-side search, cursor pagination, fulfilment exception, promised-date risk, location, or line-status filter. The page shows order value and documents but not the stock promise.

**Resolution:** build a paginated Sales Order read model with derived fulfilment quantities and exception reason. Preserve the order row as the stable parent; expose line-level facts in an expandable drawer.

### P0 - Reserved and pending quantities are fragmented

The backend already computes `orderedQty`, `reservedQty`, `dispatchableQty`, `backorderedQty`, `blockedQty`, and per-line status in the dispatch queue. The current Sales Order page does not consume those facts, while Pending Inward and Dispatch present separate partial views.

**Resolution:** use one canonical quantity contract across Sales Orders, Reserved & Dispatch, Pending Inward, and PDFs. Never recompute quantities independently in each frontend.

### P1 - Inventory value is labelled ambiguously

The current inventory page multiplies available quantity by selling price and labels it stock valuation. This is retail value of available stock, not accounting inventory value. It also excludes reserved/on-hand stock and is incomplete when selling prices are zero.

**Resolution:** show two explicit measures:

- **Cost value:** on-hand by lot multiplied by inward/lot unit cost, with fallback provenance.
- **Retail value:** available or on-hand multiplied by Product Master selling price, with a completeness percentage.

### P1 - Inventory aggregation stops at Product Master

The primary inventory query has only `search` and `take`. Users cannot filter by category, brand, finish, location, lot, quality state, stock state, price completeness, inbound status, or last movement. Server-side pagination and sort are absent.

**Resolution:** expose product summary and lot/location detail in one master-detail page, supported by cursor pagination and database-side filters.

### P1 - Low-stock reporting is noisy

626 products are flagged low stock because the default threshold applies before per-SKU reorder policy is calibrated. This makes the signal too broad to action.

**Resolution:** distinguish `not stocked`, `below minimum`, `below reorder point`, `out of stock with demand`, and `inactive`. Add a calibration queue by category/velocity.

### P1 - Label selectors do not scale

The lot selector is a long native dropdown with no search, location, stock state, or virtualized loading. The Display selector is empty because no `DisplaySample` records exist; the page does not explain the empty prerequisite.

**Resolution:** use a searchable combobox backed by paginated lot/display queries. Show image, SKU/internal code, lot/display number, location, and available quantity. The empty Display state must offer **Create display sample** or link to Product Master.

### P2 - Important actions are document-first instead of task-first

The current order rows foreground Order PDF and Quote PDF, while operational actions such as reserve, procure, pick, dispatch, collect payment, and resolve promise risk are absent.

**Resolution:** one primary next action per row based on state; keep documents in a secondary menu.

### P2 - Mobile and tablet scanning are weak

Wide tables and native select lists make sales-counter and warehouse use inefficient. Current list pages do not preserve filter state or provide compact mobile row summaries.

**Resolution:** on tablet use a sticky filter dock and scrollable data grid; on mobile use a summary row with a bottom sheet for line details and state-specific action buttons.

## Proposed Sales Order Control Tower

### KPI strip

- **Commercial:** active order value, receivable balance, paid/advance, and credit exposure.
- **Fulfilment:** ordered, reserved, dispatchable, sent, and delivered quantities.
- **Exceptions:** pending inward, promise risk, payment hold, missing List Rate, and other blocked lines.

Each KPI is a filter, not a decorative card.

### Filter dock

Search order/quote/customer/SKU; order status; fulfilment status; payment status/mode; sales owner; customer; location; brand/category; promised date; created date; aging; value range; price completeness; saved views; column chooser; export.

### Row contract

Order and customer, owner, promised date, payment balance, total value, quantity track, exception state, next action, document menu. Expanded detail shows all order lines and links to quote, receipts, purchase demand/PO, lot reservations, picks, challans, invoices, returns, and ledger.

## Proposed Reserved & Dispatch Balance

This is the warehouse-facing line register. It can group by Order, Customer, SKU, Location, or Promise Date.

Required quantities per line:

`ordered -> reserved -> picked -> packed -> dispatched -> delivered`

Separate `backordered`, `cancelled`, `returned`, and `on hold`; do not force them into the forward-progress total.

Primary actions:

- Create/continue pick list
- Reassign lot or location
- Release reservation with reason
- Open pending inward / purchase demand
- Pack and create dispatch challan
- Record delivery proof
- Print/reprint lot or package labels

## Proposed Inventory Command Center

### KPIs

On hand, available, reserved, hold/damaged, inbound, cost value, retail value, low stock, zero-price stock, zero-cost stock, and stale stock.

### Table hierarchy

Product summary first, expandable to location and lot. Product rows show image, SKU/internal code, category/brand/finish, UOM and tile conversion, stock states, inbound, cost and list price, last inward/movement, threshold, and exception.

### Detail drawer

- Lot and location balances
- Source GRN/opening stock and supplier batch
- Reservation and order allocation
- Pick/dispatch/return history
- Universal stock ledger
- Labels and reprints
- Inbound PO/demand
- Controlled adjustment and transfer actions

## Backend Read Models

### `salesOrderControlTower`

Cursor pagination, database-side search/sort, and filter input. Return order header, customer/owner, commercial totals, payment balance, promised-date risk, aggregate lifecycle quantities, exception code, next action, document availability, and line summaries.

### `reservedDispatchLines`

Join SalesOrderLine, Reservation, LotReservation, InventoryLot, InventoryLotBalance, PickLine, DispatchLine, PurchaseDemand, and StockLocation. Return canonical quantities and source IDs so every action opens the exact record.

### `inventoryControlTower`

Aggregate Product to InventoryBalance for the product row and InventoryLotBalance for drill-down. Return cost and retail values separately with completeness/provenance flags, inbound quantity/ETA, demand, last movement, thresholds, and lifecycle state.

### Query and index work

Existing single-column indexes are useful, but the control-tower queries need measured query plans and likely composite indexes around active status/date, order-line status/order, lot/location/state, reservation status/order/product, demand status/expected date, and movement product/date. Add only after `EXPLAIN ANALYZE` on representative volume.

## Implementation Plan

The detailed, field-level plan is in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). Its controlled sequence is:

1. **Policy and fixtures:** approve MRP/UOM, List Rate, legacy revision, GST, non-GST, and rounding rules.
2. **Schema and pricing engine:** persist MRP snapshots and enforce one shared validation contract.
3. **Quote workbench and PDF:** mandatory MRP capture, basis-aware comparison, readiness gates, and reconciled documents.
4. **Sales Order carry-forward:** preserve MRP, List Rate, net rate, discounts, and tax on full and partial conversion.
5. **Operational read models and UI:** implement the Sales Order, Reserved/Dispatch, and Inventory control surfaces.
6. **Release gate and AWS rollout:** migration rehearsal, reconciliation, scale, responsive, PDF, permission, rollback, and post-deploy proof.

## Acceptance Criteria

- Every order row explains what can move now and what is blocking the rest.
- Ordered quantity always reconciles to open/reserved/dispatched/delivered/cancelled quantities.
- A partial dispatch leaves an exact, traceable remaining balance.
- Pending inward links to the exact demand/PO/GRN path and auto-updates after receipt.
- Product, location, and lot inventory reconcile to the ledger.
- Cost value and retail value are never conflated.
- Missing list price or cost is visible, filterable, and cannot silently influence discount/margin approval.
- Every new or revised quote line has a basis-aware MRP before confirmation, PDF, share, approval, or Sales Order conversion.
- Final tax-inclusive unit payable cannot exceed MRP; the rule works for GST, non-GST, PC, BOX, and AREA quotations.
- All high-volume lists use server-side search, filters, pagination, stable sorting, and bounded payloads.
- Sales users can operate on tablet; warehouse users can scan and act on mobile without horizontal-page overflow.
- Permissions and audit events cover reservation release, lot reassignment, stock adjustment, dispatch, and valuation changes.

## Strengths to Preserve

- The data model already supports partial sales order conversion and line-level quantities.
- Lot/location reservation, pick, dispatch, delivery, return, and purchase-demand relationships are present.
- Physical balance edits are guarded by controlled workflows.
- Quote list price and negotiated rate are stored separately, which is the right foundation once price completeness is enforced.
- Document generation and deep links already exist and should remain secondary tools in the redesigned work queues.

# Marble Park Quote Pricing and Operations UI Implementation Plan

**Prepared:** 4 August 2026
**Status:** implementation blueprint only
**Current scope:** no application, database, deployment, or production-data change

## 1. Decisions to Approve Before Coding

### Commercial terms

| Term | Marble Park meaning | Source | Stored when |
|---|---|---|---|
| MRP | Tax-inclusive maximum price for one active quotation pricing unit | Entered or explicitly confirmed by the quote creator | Every quote line and every quote revision |
| List Rate | Marble Park's standard pre-discount, pre-GST selling rate | `Product.sellPrice` converted to the selected quotation rate basis | Snapshotted when a product is added and again only through an explicit refresh |
| Net / Negotiated Rate | Actual pre-GST unit rate offered to the customer | Discount calculation or manual override | Every quote line and revision |
| Floor Rate | Internal approval threshold; never customer-facing | `Product.floorPrice` converted to the same rate basis | Used for approval checks and audit evidence |
| Final unit payable | Net rate after line and quote discounts, plus GST when applicable | Pricing engine | Recalculated and snapshotted on save/confirm |

### Mandatory MRP rule

1. Every newly created quote line must have a finite MRP greater than zero before the quote can be confirmed, shared, printed, downloaded as PDF, approved, or converted to a Sales Order.
2. Incomplete drafts may be saved so sales work is not lost. The UI must keep the quote in `INCOMPLETE_PRICING` and show the exact missing lines.
3. A legacy confirmed quote remains readable and printable as an archived document. Creating a revision requires MRP on every active line.
4. MRP is attached to the active pricing basis: `PACK`, `PIECE`, or `AREA`. The UI label must therefore read `MRP / BOX`, `MRP / PC`, `MRP / SQ FT`, or the selected UOM.
5. Changing the line's rate basis invalidates the MRP unless a deterministic Product Master conversion exists. A converted value must be shown as a suggestion and explicitly confirmed.
6. Do not invent MRP from List Rate, negotiated rate, floor price, purchase cost, or historical totals.

### Legal and business distinction

For applicable pre-packaged goods, Indian Legal Metrology rules describe MRP as a tax-inclusive maximum retail sale price. Marble Park's requirement to capture MRP on every quote line is an ERP business rule that can be stricter than the legal declaration scope. The final rollout should be reviewed by the client's tax/legal adviser for loose tiles, project quantities, custom products, and non-prepackaged items.

## 2. Current Stack Facts

- `Product.sellPrice` is the present Product Master selling-rate source.
- Product selection copies that value into the quote line as `listPrice`.
- `QuoteLine.listPrice` and `QuoteLine.unitPrice` already preserve list and negotiated rates separately.
- `SalesOrderLine` already carries both values downstream.
- `priceQuoteLines()` already centralizes rate basis, discount, GST, floor-price approval, and line totals.
- No first-class `mrp` field exists in `Product`, `QuoteLine`, or `SalesOrderLine`.
- The production snapshot found 645 of 715 active products with `sellPrice = 0`; those lines cannot display a meaningful List Rate or percentage saving until Product Master pricing is completed.

Primary implementation touchpoints:

- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/common/pricing.ts`
- `apps/api/src/modules/quotes/quotes.service.ts`
- quote GraphQL input/output types and resolvers
- `apps/web/src/app/dashboard/quotes/new/page.tsx`
- `apps/web/src/app/dashboard/quotes/[id]/page.tsx`
- `apps/web/scripts/render-quote-pdf.cjs`
- Sales Order conversion, receivables, approval, and document tests

## 3. Data Model

### Product Master

Add an optional verified default, not a silent quote authority:

```text
Product.mrp                  Decimal? or Float? during the existing money model
Product.mrpRateBasis         String?   // PACK, PIECE, AREA
Product.mrpVerifiedAt        DateTime?
Product.mrpVerifiedById      String?
Product.mrpSource            String?   // PACKAGE, BRAND_LIST, MANUAL
```

`Product.mrp` may prefill a quote-line suggestion only when its basis can be matched or converted. The quote creator must still confirm it. Product Master can remain usable when this value is missing because the client's explicit requirement is mandatory quote-line capture.

### Quote line snapshot

Add first-class fields:

```text
QuoteLine.mrp                Decimal/Float, initially nullable during migration
QuoteLine.mrpRateBasis       String
QuoteLine.mrpSource          String     // MANUAL, PRODUCT_MASTER, CONVERTED
QuoteLine.mrpConfirmedAt     DateTime?
QuoteLine.mrpConfirmedById   String?
```

Also snapshot enough conversion context in existing metadata or explicit fields:

```text
pricingUom
rateBasis
piecesPerPack
coveragePerPack
sourceSalesUom
sourceMrp
```

Do not rely only on mutable JSON for the primary MRP value. It must be queryable, auditable, exportable, and available to PDF/Sales Order conversion without ad hoc parsing.

### Sales Order line snapshot

Carry forward the confirmed commercial contract:

```text
SalesOrderLine.mrp
SalesOrderLine.mrpRateBasis
SalesOrderLine.mrpSource
```

The Sales Order must never recalculate historical MRP or List Rate from the current Product Master. It receives the exact confirmed quote-version values.

### Money representation

The current schema uses floating-point fields. MRP can initially follow the current convention to keep the release focused, with centralized two-decimal rounding. A later controlled migration should move all money fields to a fixed decimal type together; changing only MRP would create mixed arithmetic and serialization behavior.

## 4. Migration Strategy

1. Add nullable MRP fields and indexes where operational filtering needs them.
2. Deploy code that reads both old and new records safely.
3. Mark historical lines without MRP as `LEGACY_MRP_MISSING`; do not backfill guessed values.
4. Permit archived legacy PDFs to regenerate from the historical commercial snapshot with an explicit legacy marker in internal diagnostics, not on the customer PDF unless approved.
5. Require MRP when a legacy quote is revised or any line is edited commercially.
6. Carry MRP to Sales Orders only from confirmed quote versions after the release gate is enabled.
7. After all current drafts are corrected, enforce application-level non-null validation. A database `NOT NULL` constraint can follow after a measured cleanup report proves zero missing active rows.
8. Keep the feature behind one release flag until API, frontend, PDF, and Sales Order conversion are deployed together.

Rollback must disable the gate while preserving newly stored fields; it must not delete captured pricing evidence.

## 5. Pricing Engine Rules

Implement MRP validation inside the shared pricing service so create, update, revision, approval, PDF, and Sales Order conversion cannot disagree.

### Required inputs

- `mrp > 0`
- `listPrice >= 0`
- `unitRate >= 0`
- line and quote discount each between 0 and 100
- positive quantity
- valid `PACK`, `PIECE`, or `AREA` basis
- positive pack or coverage conversion where required

### MRP ceiling

The comparison must use the final tax-inclusive amount for one pricing unit after all discounts:

```text
discountedNetUnit = unitRate * (1 - quoteDiscountPercent / 100)
finalUnitPayable  = discountedNetUnit * (1 + taxRate / 100)
require finalUnitPayable <= mrp + roundingTolerance
```

- For a non-GST quote, `taxRate = 0`, so final payable equals the discounted net unit rate.
- Use an INR 0.50 tolerance only for aggregate-to-unit rounding; store the exact rounded values used.
- The comparison is per active pricing UOM, never inventory quantity when those bases differ.
- If a manually entered negotiated rate exceeds the MRP ceiling, block confirmation and show the maximum allowed pre-tax net rate.
- Floor-rate breaches follow the existing approval path. MRP breaches are hard validation errors, not approvable discounts.

### Discount semantics

- Displayed line saving should be based on MRP only when the customer-facing design labels it `Saving from MRP`.
- Existing `discountPercent` remains List Rate to negotiated-rate discount.
- Do not mix these two percentages.
- When List Rate is missing, show `List Rate missing`; retain the negotiated rate but do not display a calculated list discount.
- If List Rate exists and exceeds MRP after equivalent tax normalization, flag Product Master for correction.

### Tile and multi-UOM behavior

| Quotation basis | MRP input label | Quantity used for line pricing |
|---|---|---|
| PACK / BOX | MRP / BOX | Number of boxes |
| PIECE | MRP / PC | Pieces derived from boxes when stock is box-based |
| AREA | MRP / SQ FT or SQ M | Area derived from coverage per pack |

When a user changes basis:

1. Recalculate List Rate using existing Product Master conversions.
2. Clear negotiated rate unless the user confirms a converted suggestion.
3. Clear or invalidate MRP unless its source basis can be converted exactly.
4. Show the source package MRP and conversion formula in the audit drawer.
5. Block confirmation if coverage or pieces-per-pack is missing.

## 6. GraphQL and Service Contract

### Inputs

Add MRP fields to quote create, update, revision, and line-edit inputs. Reject unknown basis values and invalid numbers at the resolver boundary, then rerun the same checks in the service layer.

### Outputs

Return, per line:

- MRP, MRP basis, source, confirmation user/time
- List Rate and source Product Master update time
- Net rate, line discount, quote discount
- tax rate, taxable value, tax amount, gross line total
- final unit payable and MRP variance
- floor-price result and approval state
- pricing completeness code and human-readable remediation

### Quote lifecycle

- `SAVE_DRAFT`: accepts missing MRP and returns completeness errors without losing data.
- `CONFIRM`, `APPROVE`, `SHARE`, `GENERATE_PDF`, `CONVERT_TO_SO`: require zero pricing-completeness errors.
- `REVISE`: copies previous snapshots and requires confirmation of every line whose MRP is legacy, missing, or invalidated by a basis/rate change.
- Commercially frozen confirmed quotes remain immutable; edits create a new version.

### Error contract

Use structured application errors, for example:

```json
{
  "code": "QUOTE_MRP_REQUIRED",
  "field": "lines[2].mrp",
  "lineKey": "...",
  "message": "Enter MRP / BOX for OHS-CHR-1613 before confirming this quote.",
  "remediation": "Open line 3 and enter the tax-inclusive MRP for one box."
}
```

Keep the existing trace reference. The frontend should focus the exact field and preserve all entered data.

## 7. Quote UI Specification

The updated interactive mockup is the implementation target.

### Header and KPI command band

Show compact grouped metrics that are actionable:

- Lines and items
- Gross MRP value
- List value
- Offered value
- Customer saving from MRP
- GST amount
- Below-floor lines
- Missing MRP
- Missing List Rate
- Pricing readiness

Clicking an exception KPI filters or focuses the affected lines.

### Quote setup

- Customer, sales owner, intent/lead linkage, validity and promised date
- GST or non-GST treatment
- rate basis controls for tile lines
- price visibility/PDF presentation
- terms, remarks and quote-wide discount
- brand-logo selection and document presentation settings already in scope

### Line editor

Each line must show, without opening a separate modal:

1. Product image, SKU/internal code, brand, finish and area.
2. Quantity and pricing UOM.
3. Mandatory `MRP / <UOM>` input with tax-inclusive helper text.
4. Read-only List Rate from Product Master, with `Open Product Master` when missing.
5. Discount and negotiated net rate.
6. GST and final unit payable.
7. Gross line total, saving, floor-rate state and stock promise.

MRP errors appear inline and in a sticky pricing-validation summary. Save Draft remains available; Confirm, PDF and Send remain disabled until every active line is valid.

### Efficiency controls

- `Apply verified Product Master MRP` to eligible selected lines.
- Bulk rate-basis change only when conversion data is complete.
- Keyboard flow: quantity -> MRP -> discount/net -> next line.
- Preserve line collapse state and scroll position.
- Search and add products without leaving the quote.
- On mobile, use stacked line cards and a sticky bottom bar with Draft, Errors and Confirm actions.

## 8. Customer PDF and Print Rules

For each line, the default presentation should show:

- image and product identity
- quantity and UOM
- MRP per pricing UOM
- offered rate before GST
- saving from MRP where mathematically valid
- GST rate/amount only for GST quotations
- final line payable

Document totals must reconcile exactly with the confirmed quote snapshot. Brand assets and product images must be stored locally/object-storage-backed before PDF rendering; external image URLs cannot remain runtime dependencies.

PDF tests must cover:

- GST and non-GST quotes
- PC, BOX and AREA pricing
- remote image intake followed by local persistence
- missing image fallback without a blank broken frame
- one-page and multi-page pagination
- brand-logo grid wrapping
- print, download, share and regenerated historical documents

## 9. Operational UI Work

### Sales Order Control Tower

Use grouped command-band KPIs:

- Commercial: active value, receivable balance, paid/advance, credit exposure
- Fulfilment: ordered, reserved, dispatchable, sent, delivered
- Exceptions: pending inward, promise risk, payment hold, unpriced lines

The row's primary action must be the next valid operational action, not a PDF link. Documents remain in the secondary action menu.

### Reserved and Dispatch Balance

Expose the canonical stage flow and all non-forward states:

```text
ordered -> reserved -> picked -> packed -> dispatched -> delivered
```

Track backordered, blocked, cancelled and returned separately. Every quantity must open its source line, lot/location reservation, pick, challan, delivery or return record.

### Inventory Command Center

Group KPIs into:

- Physical stock: on hand, available, reserved, hold/damaged
- Supply and service: inbound, out of stock with demand, below reorder, stale stock
- Value and quality: cost value, retail value, missing cost, missing List Rate

Use server-side search, filters, stable sorting and cursor pagination. Product rows expand to location and lot. Cost and retail value must never share one ambiguous `valuation` label.

## 10. Read Models and Performance

Build three canonical APIs:

1. `salesOrderControlTower`
2. `reservedDispatchLines`
3. `inventoryControlTower`

Requirements:

- bounded cursor pagination, never an unbounded master list
- deterministic tie-break sorting
- database-side full filters and search
- role and location authorization before aggregation
- returned aggregate totals calculated over the full filtered result, not the visible page
- explicit completeness and exception codes
- measured `EXPLAIN ANALYZE` before adding composite indexes
- cancellation/debounce for type-ahead search
- virtualized or paginated comboboxes for lot/display selection

## 11. Test Matrix

### Pricing unit tests

- MRP missing, zero, negative, NaN and valid
- GST 0%, 5%, 12%, 18% and 28%
- line discount, quote discount and manual negotiated override
- gross unit exactly at MRP, below MRP and above MRP
- below-floor approval independent from MRP validation
- PC, BOX and AREA conversions with rounding
- rate-basis change invalidates stale MRP

### Quote integration tests

- create draft with missing MRP
- exact structured error on confirm
- complete all MRP values and confirm
- revise confirmed quote and preserve prior snapshot
- legacy quote view/PDF and revision gate
- convert selected lines partially to Sales Order
- verify MRP/List/net/tax snapshot equality downstream

### Lifecycle tests

- in-stock full reservation and dispatch
- mixed in-stock and pending-inward order
- partial Sales Order conversion
- partial pick and dispatch with exact remaining balance
- PO -> GRN -> lot -> reservation release -> dispatch
- return and reverse stock/payment effects
- advance, receipt, allocation and outstanding balance

### UI and document QA

- desktop 1440x900 and wide desktop
- tablet portrait and landscape
- mobile 390x844
- keyboard-only and visible focus
- no horizontal page overflow
- empty, loading, error, partial and large-data states
- quote PDF visual comparison and extracted-total reconciliation
- Safari and Chromium-based browser checks

### Scale gates

- 3,000+ tile designs
- 10,000+ Sales Order lines
- 500+ searchable lots in a product/location scope
- filter and first-page response budgets measured on production-like data
- no frontend request that downloads the full Product Master or lot register

## 12. Release Sequence

### Phase 0 - Policy and fixtures

- Sign off the pricing glossary, MRP/UOM rule and legacy policy.
- Create representative GST, non-GST, PC, BOX, AREA, zero-list-price and legacy fixtures.
- Record baseline API, PDF and operational totals.

### Phase 1 - Schema and pricing engine

- Add nullable fields and migration.
- Implement shared MRP validation and structured errors.
- Add GraphQL contracts and service tests.
- Verify no change to historical confirmed totals.

### Phase 2 - Quote workbench and PDF

- Implement mandatory MRP capture, readiness KPIs and field-focused errors.
- Add basis-aware conversion behavior.
- Update quote PDF, print, download and share.
- Verify line and document totals against API snapshots.

### Phase 3 - Sales Order carry-forward

- Copy commercial snapshots on full and partial conversion.
- Expose MRP, List Rate and net rate in internal Sales Order detail.
- Verify receivables and payment logic remains based on confirmed gross totals.

### Phase 4 - Operational read models and UI

- Implement the three read models.
- Build Sales Order, Reserved/Dispatch and Inventory work surfaces.
- Add saved views, filter persistence, drawers and next-valid actions.

### Phase 5 - Release gate and AWS rollout

- Run unit, integration, end-to-end, PDF and responsive QA.
- Reconcile database quantities and financial totals.
- Test migrations and rollback on a disposable copy.
- Deploy API and web as one compatible release.
- Run post-deploy smoke tests and retain evidence before client use.

## 13. Definition of Done

- Every active quote line has a confirmed, basis-aware, tax-inclusive MRP.
- List Rate has one documented source and is never silently replaced by MRP or negotiated rate.
- Quotes above MRP cannot be confirmed, printed, shared, approved, or converted.
- Missing Product Master List Rate is visible and cannot produce a fake percentage discount.
- GST/non-GST, PC/BOX/AREA, quote-wide discount and floor approval calculations reconcile to the API and PDF.
- Full and partial Sales Order conversions preserve exact commercial snapshots.
- Sales Orders, Reserved/Dispatch and Inventory use canonical lifecycle quantities.
- Every KPI filters the relevant work queue and every visible quantity drills to source evidence.
- High-volume pages use bounded server-side queries and pass tablet/mobile QA.
- Migration, rollback, audit, permissions, documents and post-deploy smoke evidence are complete.

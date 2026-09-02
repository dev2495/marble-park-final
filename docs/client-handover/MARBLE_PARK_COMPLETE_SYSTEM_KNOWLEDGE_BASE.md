# Marble Park Retail OS — complete system knowledge base

**Knowledge version:** 2026-08-26
**Application release reviewed:** `codex/shared-labels-tile-master-release` release candidate, 2026-08-26
**Timezone:** Asia/Kolkata
**Audience:** live users, administrators, support staff, trainers, and an AI help assistant
**Authority:** this guide explains the application behavior in the reviewed source. The live database record, role permissions, audit event, and posted commercial document remain the final authority for an individual transaction.

> Do not put passwords, reset links, session cookies, database exports, or private document-share links into an AI assistant. An assistant may explain a workflow, but it must never invent a stock quantity, customer balance, cost, MRP, permission, approval, or document status.

## 1. What Marble Park is

Marble Park is a retail operating system for sanitaryware and tiles. It connects:

1. governed master data;
2. customer, lead, intent, and quote work;
3. purchase demand, purchase orders, and goods receipts;
4. exact product, location, lot, batch, reservation, and stock movement records;
5. labels, QR scans, display assets, picking, dispatch, delivery, and returns;
6. invoices, collections, credit exposure, documents, reports, approvals, and audit.

The central design principle is traceability. A commercial or physical event is not corrected by deleting history. It is revised, cancelled, voided, returned, adjusted, or reversed with a reason and an audit trail.

## 2. System architecture and source of truth

### 2.1 Runtime

- Web application: Next.js 15 and React 18.
- Client data layer: Apollo Client over authenticated GraphQL.
- API: NestJS 11 with GraphQL/Apollo.
- Database access: Prisma 5.
- Database: PostgreSQL 16.
- PDF/document rendering: React PDF and server-side render scripts.
- Excel import/export: ExcelJS.
- Product images: Sharp-backed processing and persistent asset storage.
- QR creation and scan: standards-valid QR payloads; ZXing camera decoding in the browser.
- Public edge: HTTPS through Caddy.

### 2.2 Authoritative records

| Question | Authoritative record |
|---|---|
| What is the sellable item? | Product, or a Product-backed Tile Variant |
| What is a tile design? | Tile Design Registry |
| What is tile geometry/area? | Tile Size Master |
| What is the permanent warehouse identity? | Product SKU/internal code created for the product or tile variant |
| What is MRP? | Current Product Master MRP plus the transaction snapshot where captured |
| What did stock cost? | PO/GRN and exact received-lot cost snapshot, not a manually assumed Product cost |
| How much stock exists? | Lot/location ledger and derived balances |
| What is reserved? | Reservation records linked to an order line and location/lot where allocated |
| What was sold/invoiced/collected? | Sales Order, Sales Invoice/Credit Note, Customer Payment and Allocation respectively |
| What happened and who did it? | Lifecycle record plus System Audit event |

### 2.3 Non-negotiable inventory equation

For a product/location/lot, posted movements determine stock. The application must not treat a typed aggregate balance as an independent source.

`available = on hand - reserved - damaged/held quantity`

Displayed summaries are derived views. Opening stock, GRN, transfer, display issue/return, dispatch, customer return, and approved count adjustment are the governed movement sources.

## 3. Users, roles, permissions, and sessions

### 3.1 Standard roles

| Role | Normal responsibility |
|---|---|
| Admin | Full application and configuration access |
| Owner | Full operating, reporting, approval, audit, and user access |
| Sales Manager | Sales leadership, quote/approval, customer account, sales/finance reports |
| Sales | Assigned CRM, showroom scan, quote, documents, and sales reports |
| Inventory Manager | Products, masters, imports, locations, counts, procurement, GRN, stock and inventory reports |
| Dispatch Operations | Pick, dispatch, delivery, returns, documents, fulfilment reports |
| Office Staff | Quote, procurement/GRN, fulfilment, and document workflows |

### 3.2 Permission keys

The backend enforces permissions; hiding a menu is not the security boundary. Available permission families are:

- users and settings management;
- audit and approvals;
- products, masters, imports, and stock locations;
- inventory, counts, procurement, GRN, dispatch, and returns;
- payments and quotes;
- executive, sales, inventory, procurement, finance, fulfilment, audit, and export reports;
- document view/manage;
- exceptional duplicate-customer creation.

An owner/admin may add an explicit `true` override or remove a role permission with a `false` override. Use overrides only for a documented exception. After changing a user, verify one allowed and one denied action as that user.

### 3.3 Session behavior

- Sign in with an individual email and password; never share the owner account.
- Passwords are at least 12 characters.
- Every authenticated session ends after exactly 15 minutes of true inactivity.
- Keyboard, pointer, touch, input, and deliberate scroll are meaningful activity.
- Polling, animation, charts, and an untouched background tab do not extend a session.
- A warning appears shortly before expiry. Use **Stay signed in** only while still at the device.
- Logout and expiry synchronize between Marble Park tabs.
- The server rejects stale sessions; the browser warning is only the usability layer.
- Authentication uses an opaque `HttpOnly`, `Secure`, `SameSite=Lax` cookie, not a token in local storage.
- Password change, administrator reset, deactivation, and explicit logout revoke applicable sessions.
- If Safari reports invalid credentials, replace stale AutoFill content. Do not keep guessing; request an audited reset.

## 4. Navigation and global controls

### 4.1 Main navigation

**Operate:** Command Center, Approvals, Sales Desk, Reports.
**Pipeline:** Leads, Intents, Quotes, Orders, Customer Accounts, Documents.
**Stock:** Catalogue, Inventory, Stock Alert Policy, Pending Inward, Procurement, Transfers, Display Assets, Labels & Scan, Stock Control, Dispatch, Returns.
**People & Data:** Customers, Users, System Audit, Master Data, Settings.
**Account:** Help Center, My Profile, Sign out.

The menu is role-aware. A missing menu normally means the signed-in role lacks its required permission. It is not proof that the feature does not exist.

### 4.2 Global search

- Search accepts product/SKU terms and relevant lead or quote terms.
- Type at least two characters.
- Results are bounded and grouped; selecting a result opens its source page.
- Search does not change stock or commercial state.

### 4.3 Common list controls

- Search boxes are debounced so typing does not submit every keystroke.
- Server-paged screens reset to page 1 when a material filter changes.
- Status/date/owner/vendor/location filters narrow the authoritative query.
- Column sort changes query order where available.
- Previous/Next controls retain current filters.
- Empty state means no matching rows, not necessarily that the domain has no data.
- Loading state must finish before the displayed count is treated as final.
- Export/print follows the active report or document rules, not necessarily only the visible page.

## 5. Master-data model

### 5.1 Generic Product Master

Use for sanitaryware and other non-tile sellable SKUs.

Key fields include permanent SKU/internal code, display/product code, name, category, brand, finish, UOM, tax behavior, packing, MRP, optional floor price, aliases, status, and images.

Rules:

- A new SKU requires positive MRP.
- MRP is editable only through the governed master workflow and retains MRP history/audit.
- Floor price is optional. A quote below it requires the configured approval path.
- Procurement/lot cost is not a user-editable selling-price field.
- Archive a discontinued item; do not reuse its permanent code for another item.
- Add supplier, barcode, showroom, and legacy codes as aliases.

### 5.2 Tile Design Registry

Design owns stable catalogue identity and imagery:

- permanent design code;
- design name;
- Brand Master selection;
- images;
- active/archive state.

Do not duplicate the design merely because another size exists. The permanent design code is not renamed after transactional use.

### 5.3 Tile Size Master

Size owns geometry, not design:

- governed size code/name;
- length and width;
- measurement unit;
- calculated area, including SQFT coverage used for pricing and fulfillment;
- active/archive state.

Only tile workflows use this controlled source. Correct geometry carefully because area affects pricing and box derivation.

### 5.4 Tile Variant Registry

One active combination of **Design × Size × Finish** becomes one inwardable, quotable Product-backed warehouse SKU.

Variant owns:

- immutable warehouse SKU/internal identity;
- optional human display/product code;
- governed Size and Finish Master selections;
- pieces per pack;
- purchase and sales UOM;
- loose-piece policy;
- mandatory MRP per SQFT;
- optional floor price;
- aliases and status.

The variant does not own stock. Opening stock or GRN creates stock lots later.

### 5.5 Brand, Category, Finish, Vendor, Architect, and UOM masters

- **Brand:** display name and governed brand code used on product identity, quotes, and labels.
- **Category:** controlled grouping for catalogue, intent, quote, and reports.
- **Finish:** controlled finish values used by products/variants and filters.
- **Vendor:** supplier identity used by PO/GRN and procurement analysis.
- **Architect:** consulting architect/firm attribution on quotes and reports.
- **UOM:** controlled commercial/physical unit definitions.

Edits are audited. Archive unused values rather than replacing history. Do not merge two meanings by renaming a used master value.

### 5.6 Excel imports

1. Download a fresh sample so dropdown/reference sheets reflect current masters.
2. Fill only supported columns and use exact governed codes.
3. Upload and preview.
4. Resolve duplicate codes, invalid masters, MRP, packing, and UOM errors.
5. Confirm only when the preview is clean.
6. Import is all-or-nothing where stated; it must not create stock.

## 6. Catalogue and showroom search

The Catalogue is image-led product discovery for users with product access.

- Search by SKU, internal/display code, name, brand, category, finish, or alias where supported.
- Filter and page through results; do not load the full catalogue into a single browser list.
- A missing image is a master-data readiness issue, not a reason to create a duplicate SKU.
- Product detail should display identity, sellable/archived state, MRP, availability summary, and relevant commercial actions allowed by role.
- Tiles show Design, Size, Finish, packing, and SQFT pricing semantics without repeating redundant identity text.

## 7. Customer, lead, and intent workflow

### 7.1 Customers

- Search before creation to prevent duplicates.
- Maintain name, contact details, city/site context, GST/credit details where applicable.
- Duplicate override is restricted and should record why a separate customer is required.
- Customer history links leads, quotes, orders, invoices, payments, and documents.

### 7.2 Leads

1. Select or create the customer.
2. Record project/site, source/channel, owner, budget/timeline, requirement, and next action.
3. Add notes/activities as the opportunity develops.
4. Create an intent for room/use-level product selection.
5. Do not mark a lead won merely because a quote exists; use the governed lifecycle.

### 7.3 Intents

Intent records what the customer is considering before final commercial agreement.

- Organize selections by room/use.
- Search or scan product identities.
- Enter quantity; for tiles, enter area and wastage so physical packs can be derived.
- Save draft while editable; submit when the selection is ready.
- Submitted, quoted, or cancelled intents are frozen for audit; revise through the supported flow.
- Scan does not reserve stock.

### 7.4 Mobile showroom scanning

1. Tap **Scan showroom item**; camera starts only after deliberate permission/action.
2. Scan an active `MP-LABEL:<label-code>` QR.
3. Verify exact physical identity: product, lot, or display asset.
4. For a tile, the exact scanned variant is highlighted and selected by default.
5. The selector may show only active variants sharing the same Tile Design.
6. Filter those alternatives by size, finish, or code; select one or several.
7. Add selected variants to intent or Quick Quote.
8. Existing intent rows are not duplicated.
9. Zero-stock variants may be quoted but must remain visibly unavailable.
10. Set customer, room, quantity/area, and save/submit before leaving.

## 8. Quote Studio and commercial pricing

### 8.0 Choose the quotation family

Every quotation has one visible, immutable commercial family once lines exist:

- **Tile & Chemical:** accepts only governed Tile variants and Chemicals. Tiles are fulfilled by boxes/pieces but priced and printed per SQFT; Chemicals are governed, quoted, and printed in KG.
- **CP & Sanitary:** accepts faucets, sanitaryware, accessories, and every governed non-Tile/non-Chemical product family using its commercial UOM.

The Quote Register, quote detail, customer PDF, and API retain this family. Search and scan deliberately show cross-family guidance instead of allowing a mixed quote. Use two separate quotes when a customer needs both families.

### 8.1 Build a quote

1. Choose **Tile & Chemical** or **CP & Sanitary**.
2. Choose the customer, responsible sales user, optional architect, project/title, and validity.
3. Search or scan products; a scan can offer same-design tile variants within a Tile & Chemical quote.
4. Group selections by area/room where useful.
5. Enter physical quantity. For tiles, enter required area and wastage; the system derives boxes/pieces. For Chemicals, enter KG.
6. Review read-only MRP from Product Master.
7. Enter NRP/base discount as percent or rupees. Percent is default and applies to MRP.
8. Enter optional special discount as percent or rupees. It applies to NRP.
9. Select GST behavior where allowed.
10. After all lines are ready, enter optional whole-quote discount as percent or rupees.
11. Review totals/readiness, save draft, validate, issue/share PDF, or submit for approval as appropriate.

Keyboard controls:

- `/`: focus product search;
- `Tab`: move through fields;
- `Cmd/Ctrl+S`: save draft;
- `Cmd/Ctrl+Enter`: validate;
- `Esc`: close scan/secondary panel.

### 8.2 Pricing formulas

For each line:

`MRP value = pricing quantity × MRP rate`

`NRP rate = MRP rate - NRP discount`

`special rate = NRP rate - special discount`

`line net before quote discount = pricing quantity × special rate`

The whole-quote discount is allocated proportionally to lines so Quote Register, PDF, Sales Order conversion, and later snapshots reconcile.

Rules:

- MRP must be positive and is not typed freely on the quote.
- NRP discount cannot exceed MRP.
- Special discount cannot exceed NRP.
- Quote discount cannot exceed the pre-discount line-net total.
- A rate below optional floor price requires owner/authorized approval.
- Customer output shows MRP, final selling rate, quantity, and total only. It does not show NRP, floor, cost, internal discount ladder, or a savings claim.
- Generic products show their applicable price per commercial UOM.
- Tiles always show MRP/final rate per SQFT, while boxes/pieces remain the physical fulfillment quantity.
- Chemicals always show MRP/final rate and quantity in KG and may appear only in a Tile & Chemical quote.
- A Tile & Chemical PDF has dedicated Box/Pc/Kg, Total SQFT, MRP rate, final selling rate, and amount columns; CP & Sanitary retains its product-oriented presentation.
- Brand code and product code identify the item on supported quote/label outputs.

### 8.2.1 Governed served-brand footer

- Owners/admins configure two independent global footer policies in **Settings → Served-brand policies by quote family**: one for Tile & Chemical and one for CP & Sanitary.
- Each policy can include all active quote-enabled brands, an exact selected portfolio, or no brand strip.
- Quote Studio and quote detail show the result as read-only. Sales users cannot add or remove footer brands per quote.
- When a quote is created, the API snapshots the matching global policy and printable brand identity (ID, name, code and immutable logo asset URL) into quote metadata. Later global changes affect future quotes only; existing customer documents retain their selected brand identity and audit lineage.
- Brand Master remains the source for name, code, logo artwork, active status, and quotation eligibility.

### 8.3 Quote states and actions

- **Draft/incomplete pricing:** editable; missing governed pricing prevents a commercial PDF/order.
- **Ready/sent:** customer document can be generated/shared and sending is recorded.
- **Approval required:** commercial exception waits for an authorized decision.
- **Confirmed:** accepted commercial snapshot can convert to order.
- **Superseded:** retained earlier revision; not the current agreement.
- **Lost/cancelled:** close with a reason; do not delete.

Use **View** for detail/source, **PDF** for governed customer output, **Send/share** for the tracked share flow, and **Convert to SO** only for accepted quantities.

### 8.4 Revisions and partial conversion

- Create a revision when customer-negotiated lines change after issue.
- Convert only the quantities confirmed now.
- Remaining quoted quantity stays open until accepted or closed with reason.
- Each conversion is idempotent and retains quote lineage.
- Shortage becomes backorder/purchase demand; it must not be represented as available stock.

## 9. Sales Orders, reservations, and availability

- A Sales Order is a commitment, not invoice revenue.
- Order lines snapshot the commercial agreement and physical fulfillment unit.
- Available stock is reserved according to allocation rules; shortages remain backordered.
- Reservations reduce availability but not on-hand stock.
- Cancelling an unfulfilled quantity releases its reservation and records a reason.
- Dispatch consumes exact picked lots; invoice and collection are separate lifecycle facts.

## 10. Procurement

### 10.1 Procurement workspace

Tabs/sections:

- **Overview:** operational KPIs, open demand, active PO/receiving work, exceptions, and recent activity.
- **Demand:** customer shortage or planned replenishment queue; searchable, filterable, sortable, and multi-selectable.
- **Purchase Orders:** create PO and review open/partial/completed/cancelled history.
- **Receiving:** receive against PO or post a genuine Manual GRN.
- **History:** searchable GRN/PO activity, source links, labels, and display handoff.

### 10.2 Create a purchase order

1. Select active demand lines or search products/variants for planned replenishment.
2. Select a governed Vendor.
3. Enter ordered physical quantity.
4. Enter supplier rate and Rate UOM if known, or leave the rate blank without delaying the PO.
5. Confirm packing conversion; a BOX/SET rate entered now, during inward, or after inward is normalized through the captured pack factor.
6. Enter expected date and optional supplier/reference information.
7. Enter optional header discount.
8. GST is optional; blank/zero means without GST.
9. Review known subtotal/discount/tax/total and any clearly marked pending-rate lines.
10. Create PO and generate the supplier PDF.

PO cost is the commercial acquisition cost for its line/lot. It is not a permanent product selling-price field.

### 10.3 Receive against a PO

1. Select an open/partial PO.
2. Receipt quantities start blank; type only what arrived.
3. Capture supplier bill/challan, receiving date, location, batch, and trace fields.
4. For tiles capture boxes, permitted loose pieces, shade, caliber, and grade.
5. Record damage separately; damage is not available stock.
6. A rated line inherits its locked PO net pre-tax unit-cost snapshot and cannot replace it. If the supplier rate is still unknown, leave it blank; receipt is allowed and both the GRN and exact lot remain visibly cost-pending.
7. Post receipt; the system creates GRN, exact lot, lot balance, stock ledger, and audit/source links. When the supplier confirms the cost later, an owner records it in the permanent delayed-cost queue without changing stock quantity.
8. A partial PO remains open for its remaining base quantity.

### 10.4 Manual GRN

Use only when goods genuinely arrived without a prior PO.

- Select supplier/product/location.
- Enter physical quantity and trace fields.
- Enter positive supplier rate and Rate UOM.
- State the reason for the manual path.
- Review normalized pre-tax unit cost before posting.

### 10.5 Permanent delayed-cost queue

Every non-cancelled PO line without a supplier rate remains in this owner/admin queue before or after inward—even when the supplier confirms cost 10–20 days later. Record only verified rates. For a received line, completion updates its original PO line, GRN cost snapshot and exact-lot cost snapshot through one audit event without posting a stock movement. Existing positive costs are never silently overwritten, and historical POs are never deleted merely to bypass validation.

## 11. Inventory and exact-lot lifecycle

### 11.1 Opening stock

Use once for verified existing stock being brought under control:

1. create a session for a location/effective date;
2. add product/variant, quantity, exact lot/reference, and required verified cost provenance;
3. review totals and exceptions;
4. submit/approve as required;
5. post once;
6. system creates opening-stock ledger entries and lots.

Never reuse opening stock for a normal supplier receipt.

### 11.2 Inventory overview/control tower

Use summary cards and exception queues to answer:

- what is on hand, available, reserved, damaged, or backordered;
- what stock is below policy;
- which lots are missing governed cost;
- what inbound, transfer, count, or dispatch work is pending.

Expand a product to see exact locations/lots and source documents. Stock value means active lot quantity × governed lot unit cost; missing cost stays explicit.

### 11.3 Stock locations and lots

- Location identifies warehouse/branch/plant.
- Zone is the user-facing placement within a showroom/warehouse flow.
- Lot identifies a specific receipt/opening source, product, batch/trace details, received date, quantity, cost snapshot, and location lineage.
- Do not merge lots with different cost, batch, shade, caliber, grade, or provenance.

### 11.4 Transfers

1. choose source and destination locations;
2. select exact available product/lot quantities;
3. submit/approve if required;
4. issue from source;
5. receive at destination;
6. ledger retains both sides and in-transit state.

Transfer does not create a sale or purchase.

### 11.5 Stock counts

- Choose location and count type (cycle/month/year-end as applicable).
- Search/select count scope.
- Enter physical counted quantity; do not overwrite book quantity.
- Save/post count session.
- Review variance; approved adjustment posts separately.
- Recent sessions and status provide the count audit trail.

### 11.6 Adjustments and period close

- Choose exact lot and adjustment direction/quantity.
- Enter a specific reason and supporting reference.
- Submit for approval.
- Approver accepts/rejects; only approved adjustment posts to the universal ledger.
- Close month/year only after procurement receipts, transfers, dispatch/returns, and the matching posted physical count are complete.
- A closed period blocks further posting into that period; do not alter dates to evade the lock.

### 11.7 Reconciliation

Reconciliation compares:

- product aggregate balance;
- location balance;
- lot balance;
- reservations/backorders;
- universal stock ledger.

Use **Refresh check** after imports or high-volume activity. An OK result means the compared sources align at that generation time. Warning/critical rows require source-level investigation before making promises or closing a period. Never repair a mismatch by direct database edit.

### 11.8 Stock ledger

The ledger shows every governed movement: opening, GRN, reservation-related physical issue where applicable, transfer, display issue/return, dispatch, customer return, and approved adjustment. Search/filter/page to a source row, then follow its document identifiers. The ledger is append-oriented history, not an editable register.

### 11.9 Stock alert policy

Maintain reorder thresholds/policies for supported product-location combinations. Alert is a decision aid; it does not create stock. Confirm open demand, active PO, incoming quantity, and current reservations before ordering.

## 12. Display assets

A display asset is a separately audited, non-sellable physical showroom identity.

### 12.1 From inventory

1. select **From inventory**;
2. search a recognizable product/variant;
3. choose exact received lot, with product, GRN/source, batch, location, and available quantity visible;
4. enter quantity removed from saleable stock;
5. choose showroom/branch and enter Zone;
6. enter unique display code, condition, and optional next inspection;
7. create asset and QR label.

This posts an audited issue from the exact lot and reduces available/on-hand stock as defined by the movement.

### 12.2 Free vendor sample

Use **Vendor sample** only for a genuine non-stock sample:

- select product/design identity;
- choose location and Zone;
- enter unique display code, condition, and inspection data;
- register asset and label.

It creates no GRN, inventory lot, or saleable stock quantity.

### 12.3 Lifecycle

Inspect, maintain, relocate, remove, or return using the asset action and reason. An inventory-issued asset may return only through its governed original-lot lineage. A vendor sample cannot be returned as stock.

## 13. Labels, QR, scan, print, and reprint

### 13.1 Subjects

Labels are a shared physical identity platform for product/SKU, lot, carton, shelf, and display subjects supported by the API/template.

### 13.2 Create labels

1. open a recent posted GRN or **Other subjects**;
2. choose the exact line/lot/product/display and verify image/code/source/location;
3. set explicit label count;
4. create an additive label job/run;
5. select template and only the labels required.

### 13.3 Print lifecycle

- **Prepare/preview** creates an audited prepared run.
- The isolated print route contains only the physical sheet/label surface.
- New runs use the governed version 2 portrait page: exactly 2 × 4 inches (50.8 × 101.6 mm), one PDF page per physical sticker.
- In the printer dialog choose portrait, one page per sheet, Actual size/100%, no margins, and no browser headers. Never choose A4 or Fit to page.
- Opening or cancelling the browser print dialog does not increment print counts.
- Confirm print only after paper was actually produced.
- Reprint is a new audited run with reason; it retains physical identity.
- Void a damaged/superseded label with reason; never recycle its code.

### 13.4 Label content

- unique human-readable label code;
- standards-valid QR payload `MP-LABEL:<unique-label-code>`;
- governed Brand Master code;
- Product Master/display product code;
- optional exact lot code or display code;
- direct governed rate and rate UOM; tile rate is always per SQFT.

The portrait sticker intentionally does **not** print brand name, product name, warehouse SKU, dimensions, finish, source/trace prose, or MRP/GST/tax wording. Those details remain available after QR scan and in audited master/lot records without crowding the physical sticker.

The MP center mark is branding. The QR remains standards-decodable; do not replace it with decorative pixels that reduce scan reliability.

### 13.5 Scan result

Scan resolves the actual payload, then displays source-backed product, lot, batch, location, or display information. For a tile, show same-design active variants without changing the exact scanned identity. **Quick quote** and **Add to intent** preload selected Product IDs only; they do not reserve or move stock.

## 14. Pending inward and allocation

Pending Inward represents demand/order shortages awaiting stock or allocation.

- Search by order/customer/product/document.
- Review required, reserved, backordered, incoming, and allocated quantities.
- Follow source to demand/PO/GRN/order.
- Allocate only posted available stock.
- Never allocate a prepared PO, unposted GRN, display asset, or damaged quantity as saleable stock.

## 15. Dispatch, delivery, and returns

### 15.1 Dispatch

1. open a ready order/job;
2. review customer/site and outstanding quantities;
3. allocate/pick exact lots and locations;
4. enter only quantity physically packed now;
5. create packages/challan and shipment details;
6. verify partial balance remains open;
7. issue/dispatch and capture delivery/OTP/proof where configured.

Dispatch is idempotent, cannot exceed available/reserved/outstanding quantity, and posts exact-lot stock movement.

### 15.2 Returns

1. select the original delivered challan line;
2. review remaining returnable quantity and original lot;
3. enter returned quantity, reason, and inspection outcome;
4. choose resell/damaged/other governed disposition;
5. receive return;
6. system restores only valid quantity to the original lot or isolates it as damaged/held.

A return does not silently change invoice/collection facts; credit note/account actions are separate.

## 16. Customer accounts, invoices, collections, and credit

- Quote booking, Sales Order, invoice, collection, and outstanding receivable are different facts.
- Customer Accounts shows invoices, payments, allocations, credit notes, ledger entries, credit profile/exposure, and collection tasks supported by source data.
- Record a payment with date, amount, mode/reference, and customer.
- Allocate payment to specific open invoice(s); unapplied credit remains explicit.
- Credit note/reversal uses governed reason and lineage.
- Credit limit/terms affect exposure controls but do not fabricate collection.
- Receivable aging uses open invoice due dates and allocations as of the selected date.
- Supplier AP, P&L, balance sheet, and cash-flow statements remain **Needs setup** unless a governed AP/GL source is connected.

## 17. Documents and sharing

### 17.1 File Vault

- Upload supported business files with an owner/entity link and useful title/category.
- Search/filter/page existing assets.
- Preview/download only with permission.
- Share links are scoped, expiring, revocable, and audited.
- Do not upload secrets or unrelated personal data.

### 17.2 Generated documents

Quote, PO, label, challan, and supported customer documents use server-rendered output. Before sending, verify number, customer/vendor, line identity, quantity/UOM, MRP/final rate or supplier rate as appropriate, GST, totals, terms, and source status.

If PDF generation is blocked, open the source record and complete the named readiness issue. Do not bypass a commercial validation by editing the PDF.

## 18. Reports

Normal users see five decision suites, not an implementation catalog.

### 18.1 Owner

- Company pulse: invoices, collections, bookings, stock, and commitments.
- Sales & mix: product/category performance.
- Stock & risk: location, lot cost, and exceptions.
- Open work: allocation, backorder, dispatch, and invoicing.

### 18.2 Sales

- Sales performance.
- Operator matrix.
- Customer and architect portfolio.
- Quote-to-order conversion.

### 18.3 Finance

- Financial health: invoices, collections, bookings, stock at cost.
- Customer receivables aging.
- Collections and payment mix.
- Accounting statements: governed **Needs setup** until GL/accounting sources exist.

### 18.4 Inventory

- Stock position by location/lot.
- Aging and velocity/slow or non-moving stock.
- Movement and lot traceability.
- Reorder and exception control.

### 18.5 Operations

- Pending fulfilment/dispatch work.
- Purchase demand, POs, inward, and exceptions.
- Vendor fulfilment performance.
- Approvals, audit, document failures, and data quality.

### 18.6 Report controls and interpretation

- Choose date preset or explicit From/To.
- Apply role-allowed owner/location/product/vendor/customer/status filters.
- Use comparison period, search, page size, sort, column selection, or saved view where offered.
- Every metric should expose definition, date basis, timezone, freshness, source coverage, and readiness.
- A chart must have a supporting table or drill-through.
- Export requires permission and uses bounded row limits.
- Print removes navigation/dashboard chrome.
- `0` means a valid zero only when the source coverage is ready; otherwise the screen must say **Needs setup**, incomplete coverage, or no matching data.

### 18.7 Reporting readiness

| Data area | How it becomes ready |
|---|---|
| Sales target/budget | Owner/admin enters positive monthly company target; revisions/voids are versioned/audited |
| Product/brand/category/finish | Correct authoritative master record |
| MRP/floor | Product/Tile Variant Master and MRP readiness workflow |
| PO/lot cost | Verified supplier rate through PO, optional capture during inward, permanent delayed-cost completion after inward, or a governed manual GRN |
| Invoice/collection/AR | Invoice, payment, allocation, credit note, and due-date lifecycle |
| Supplier AP | Requires governed supplier invoice/payment/allocation source or accounting integration |
| P&L/Balance Sheet/Cash Flow | Requires chart of accounts, journals, expenses, opening balances, and close controls |

Never type an unsupported accounting number into a generic report setup form.

## 19. Approvals, audit, cancellations, and reversals

### 19.1 Approval Desk

Approvals may include below-floor quote exceptions, stock adjustments, or other configured controls. Review source document, requested vs governed value, actor, reason, and downstream impact. Approve/reject with a meaningful reason. Empty queue means no pending item matching the user’s permission.

### 19.2 System Audit

Search/filter/page audit events by time, user, action, entity, or identifier. Detail should show actor, timestamp, action, entity, request/reference, and safe before/after metadata where recorded.

Audited domains include authentication/security, users/permissions, masters/imports, MRP, PO/GRN/cost, stock, labels/print/scan lifecycle, displays, quotes/orders/dispatch/returns, payments/documents/shares, targets/settings, cancellations/voids/reversals.

Audit is evidence; it is not a button to rewrite the source record.

## 20. Page-by-page route and action reference

| Route | Purpose | Primary actions |
|---|---|---|
| `/login` | Secure sign-in | enter email/password, reveal password, start workspace, follow safe recovery |
| `/reset-password` | Single-use recovery | validate link, enter new password, revoke old sessions |
| `/dashboard` | Role-aware command center | open actionable KPI/source queue, navigate to work |
| `/dashboard/sales` | Sales operating desk | review pipeline, owners, quote/order activity and follow sources |
| `/dashboard/approvals` | Approval queue | inspect, approve, reject with reason |
| `/dashboard/leads` | CRM pipeline | search/filter/page leads, open/create lead |
| `/dashboard/leads/new` | New lead and mobile intent | customer/project details, scan/search selections, create lead + intent |
| `/dashboard/leads/[id]` | Lead detail | activities, notes, intent/quote actions, status transitions |
| `/dashboard/intents` | Intent register | search/filter/page, open intent |
| `/dashboard/intents/[id]` | Intent editor/detail | scan/search items, edit room/quantity/area, save/submit/cancel when allowed |
| `/dashboard/quotes` | Quote register | status/architect/search/filter/sort/page, View, PDF, Send/share, Convert to SO |
| `/dashboard/quotes/new` | Full-screen Quote Studio | build/scan/price/discount/GST/save/validate |
| `/dashboard/quotes/[id]` | Quote detail/revision | inspect commercial snapshot, architect, readiness, revise, approve/send/convert |
| `/dashboard/quotes/approvals` | Quote exception desk | review below-floor/pricing exception and decide |
| `/dashboard/orders` | Sales order register | search/filter/page, view fulfilment/source |
| `/dashboard/orders/new` | Direct order | create governed order when permitted, with customer/product/quantity controls |
| `/dashboard/customers` | Customer master/history | search/page, create/edit, open relationship history |
| `/dashboard/payments` | Customer accounts | invoices, collections, allocation, credit, tasks, ledger |
| `/dashboard/documents` | File Vault | upload, search/filter/page, preview/download/share/revoke |
| `/dashboard/products` | Catalogue | image-led search/filter/page, view product, start permitted commercial action |
| `/dashboard/procurement` | Procurement workspace | Overview, Demand, create PO, open PO, Receive, Manual GRN, History |
| `/dashboard/procurement/cost-readiness` | Legacy PO cost preparation | find unrated open PO line, enter verified supplier rate/UOM/source before inward, confirm |
| `/dashboard/pending-inward` | Shortage/allocation queue | search/filter/page demand, follow PO/GRN/order, allocate posted stock |
| `/dashboard/inventory` | Inventory control tower | KPI/exception filters, expand product/lot, follow control actions |
| `/dashboard/inventory/inwards` | GRN receiving | choose PO/manual mode, enter physical receipt, post, clear form |
| `/dashboard/inventory/opening-stock` | Govern opening balances | create/import session, review, approve/post, inspect history |
| `/dashboard/inventory/transfers` | Location transfer | create, issue, receive, inspect transfer history |
| `/dashboard/inventory/display-assets` | Display lifecycle | From inventory/Vendor sample, exact lot, Zone, create QR, inspect/maintain/return |
| `/dashboard/inventory/labels` | Physical Identity Desk | Recent GRNs, Other subjects, Print & reprint, Scan & verify |
| `/print/labels/[runId]` | Isolated print surface | open print dialog, confirm only after physical output |
| `/dashboard/inventory/control` | Unified stock governance | adjustments, approvals, counts/reconciliation/close navigation |
| `/dashboard/inventory/stock-count` | Physical counts | select scope, enter counts, post session, review recent sessions |
| `/dashboard/inventory/reconciliation` | Integrity proof | Refresh check, filter exceptions, follow source evidence |
| `/dashboard/inventory/ledger` | Universal movement history | search/filter/page and trace to source |
| `/dashboard/inventory/stock-alerts` | Reorder policy | maintain thresholds, review exception status |
| `/dashboard/dispatch` | Fulfilment control | allocate/pick/pack/partial challan/shipment/delivery actions |
| `/dashboard/returns` | Reverse logistics | choose delivered line, quantity/reason/inspection/disposition, receive return |
| `/dashboard/reports` | Five report suites | suite/tab/filter/compare/search/drill/save view/export/print |
| `/dashboard/reports/setup` | Data readiness | set governed targets, follow source correction/integration actions |
| `/dashboard/master-data` | Master-data launchpad | open Product, Category, Brand, Finish, Vendor, Architect, Tile, Size, Import |
| `/dashboard/master-data/products` | Generic SKU master | search/page/create/edit/archive, MRP/floor/images/aliases/history |
| `/dashboard/master-data/pricing-readiness` | Missing MRP desk | find SKU, enter verified MRP/pricing unit, audit correction |
| `/dashboard/master-data/tiles` | Tile workspace | Design Registry, Variant Registry, imports, display/inward/labels links |
| `/dashboard/master-data/tile-sizes` | Tile geometry | create/edit/archive governed size/area |
| `/dashboard/master-data/brands` | Brand Master | create/edit/archive name/code |
| `/dashboard/master-data/categories` | Category Master | create/edit/archive controlled category |
| `/dashboard/master-data/finishes` | Finish Master | create/edit/archive controlled finish |
| `/dashboard/master-data/vendors` | Vendor Master | create/edit/archive supplier identity |
| `/dashboard/master-data/architects` | Architect Master | create/edit/archive consultant/firm identity |
| `/dashboard/master-data/imports` | Product Excel import | sample, upload, preview, validate, commit |
| `/dashboard/users` | User administration | create/edit/deactivate, role, permission overrides, reset controls |
| `/dashboard/audit` | System Audit | search/filter/page and inspect event detail |
| `/dashboard/settings` | Company/document settings | logo/address/GST/contact/terms/bank/footer and system defaults |
| `/dashboard/profile` | Personal account | profile/avatar/password, session safety |
| `/dashboard/help` | Contextual help | search/open guide, follow related workflow, print/download guide where offered |
| `/share/quotes/[token]` | Time-limited quote share | view permitted customer document only |
| `/share/documents/[token]` | Time-limited vault share | view/download permitted asset only |

## 21. Status, loading, empty, and error language

- **Loading:** wait; do not repeat a write unless the original request is confirmed failed.
- **No matching rows:** clear filters/search or change page; it is not a system failure.
- **Needs setup:** follow the named source/master/integration action. Do not enter a fake zero.
- **Incomplete pricing / MRP required:** correct Product/Variant Master, then reopen/revalidate the quote.
- **Cost setup needed:** complete verified legacy PO/lot provenance; do not enter a guessed rate.
- **Below floor:** submit for approval or change the final rate.
- **Unauthenticated/session expired:** sign in again; unsaved browser-only changes may need re-entry.
- **Forbidden/restricted:** the role lacks permission; owner reviews role/override rather than sharing credentials.
- **Conflict/already processed:** refresh and inspect source; the idempotency/concurrency guard prevented a duplicate.
- **Validation error:** correct the named field. No confirmed data changed when the UI says so.
- **Request/reference ID:** copy it with time, page, user role, and document number for support. Never include password/cookie.

## 22. Performance-aware usage

- Search instead of scrolling through thousands of rows.
- Narrow long registers by status/date/location/owner/vendor before exporting.
- Keep normal page sizes; use export for governed bulk analysis.
- Do not open many heavy report/PDF/import/reconciliation jobs simultaneously on the same workstation.
- Let an upload/post complete before retrying.
- Scan one label only after the previous result resolves.
- Use exact source links rather than opening duplicate browser tabs for every row.
- Report persistent slowness with time, route, filters, result size, role, and request ID.

## 23. Administrator operating checklist

### Daily

- public health and database readiness;
- failed login/error spikes;
- pending approvals and blocked commercial work;
- failed document jobs;
- stock critical exceptions;
- disk free space and backup result.

### Weekly

- stale open PO/GRN/demand/dispatch/collection tasks;
- missing MRP, images, lot costs, or master mappings;
- report readiness and source coverage;
- user access changes and expiring/revoked share links;
- slow requests/query symptoms and container resource use.

### Monthly

- active users, roles, permission overrides, and departed-user deactivation;
- restore drill/off-host backup evidence;
- dependency/security review;
- TLS, host updates, firewall/SSH access;
- period count/reconciliation/close;
- growth of database, assets, logs, and local backups.

## 24. AI help-assistant operating rules

An AI assistant using this document must:

1. ask which page, role, and document/status the user is on when the question is ambiguous;
2. give the shortest safe next action first, then explain why;
3. distinguish catalogue identity, physical stock, commercial booking, invoice, and collection;
4. never invent a live value or say a write succeeded without source confirmation;
5. never ask for passwords, cookies, reset tokens, full database dumps, or private links;
6. never advise direct database edits, deletion of commercial history, or bypass of approval/readiness checks;
7. respect role restrictions and direct access requests to an owner/admin;
8. use exact application page names and route when helpful;
9. tell users what will and will not change stock before a physical action;
10. state when a feature is **Needs setup** instead of offering a fake workaround;
11. collect safe support evidence: time, page, role, document number, request ID, and redacted screenshot;
12. defer to the live source record and System Audit when this guide and an individual transaction differ.

### Example response: “Why can’t I receive this PO?”

“Open Procurement → Receiving and choose the PO. Enter only what physically arrived. If the selected line says supplier rate pending, enter the verified rate and Rate UOM there; the system audits and locks it before posting the GRN and lot. If the line already has a PO rate, it inherits that net pre-tax cost and will reject any override. Owner/admin may also prepare pending rates in Legacy PO cost preparation. Do not delete the PO or use Manual GRN to bypass the control.”

### Example response: “Can I add another size after scanning a display?”

“Yes, if it is an active variant of the same Tile Design. Keep the scanned variant selected or choose other offered sizes/finishes, then Add selected to intent/Quick quote. Confirm area, wastage, MRP, and final rate. Scanning and selection do not reserve or move stock.”

### Example response: “Why is a report zero?”

“First read its readiness/coverage label and date filter. A ready zero means no matching posted source data. Needs setup means the source is absent—for example GL statements require governed accounting data. Open the source rows or Reports Setup; do not treat an unsupported zero as a financial fact.”

### Example response: “Stock is wrong; can I edit it?”

“Do not edit a balance. Open Stock Control → Reconciliation, trace the product/location/lot to its ledger source, run a physical count, and submit the variance adjustment for approval. Only the approved movement changes stock.”

## 25. Known governed boundaries

- The current deployment is a single-host system, not high availability.
- Product images/assets are stored on persistent host storage in the reviewed topology.
- Accounting statements and supplier AP require governed source capture/integration.
- Current reporting/export limits are deliberately bounded.
- Live performance capacity must be judged from measured workload, data growth, and infrastructure—not the presence of pagination alone.
- A help assistant explains the system; it does not replace permission, approval, source document, physical verification, or audit.

## 26. Support escalation template

Use this safe template:

```text
Time and timezone:
User role (not password):
Page/route:
Action/button:
Document or human-readable code:
Filters/search used:
Expected result:
Observed result:
Request/reference ID:
Redacted screenshot attached: yes/no
Was the action retried: yes/no
```

For stock, also provide product code, location, lot/GRN, and whether the issue concerns on-hand, available, reserved, damaged, or valuation. For quote/PO/PDF, provide document number and readiness/status. For scan, provide human label code and subject type without exposing private customer data.

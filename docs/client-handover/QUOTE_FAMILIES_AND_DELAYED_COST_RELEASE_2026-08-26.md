# Quote families and delayed supplier cost release

Release date: 26 August 2026

## Delivered operating rules

### Purchase order and inward cost

- Supplier rate and Rate UOM are optional when a PO is created.
- A PO-linked inward may post quantity without a supplier rate.
- The resulting GRN and exact inventory lot are created with an explicit `pending` cost status and zero provisional cost; the application does not invent a value.
- Every missing supplier cost remains on the permanent owner/admin delayed-cost queue before or after inward.
- When the verified rate arrives, the queue applies the saved PO discount, normalizes the rate to the base UOM, and updates the original PO line, GRN line, and exact lot.
- Late cost completion writes one audit event with before/after lot cost and `stockQuantityChanged: false`. Existing positive cost snapshots are not overwritten silently.
- A genuine Manual GRN remains governed separately and still requires a positive supplier rate because it has no PO lineage.

### Quotation families

| Quote family | Allowed catalogue families | Customer quantity/rate presentation |
|---|---|---|
| Tile & Chemical | Tiles and Chemicals only | Tiles: Box/Pc, Total SQFT, MRP/SQFT, final selling/SQFT, amount. Chemicals: KG, MRP/KG, final selling/KG, amount. |
| CP & Sanitary | Every governed non-Tile/non-Chemical product | Governed physical/commercial UOM with MRP, final selling price, and total. |

Both families retain the same governed commercial ladder: Product Master MRP, NRP, optional special discount, optional whole-quote discount, and GST/without-GST selection. The family changes selection eligibility and customer presentation, not the pricing arithmetic.

The family is visible in the Quote Register, Quote Studio, quote detail, API, audit metadata, and customer PDF. Search/scan results cannot silently mix the families; the user is directed to the correct quote instead.

### Served-brand footer governance

- Settings owns two independent policies: Tile & Chemical and CP & Sanitary.
- Each policy supports all active quote-enabled brands, a selected portfolio, or no footer logos.
- Brand selection controls were removed from Quote Studio and quote detail.
- The API—not the browser—snapshots the matching global policy plus each printable brand's ID, name, code and immutable logo asset URL when the quote is created; subsequent quote edits preserve that snapshot.
- Existing quotes retain their historical snapshot; global changes apply only to future quotations.

### Chemical master rule

- The governed `Chemicals` category exists with default UOM `KG`.
- Product Master create/update enforces unit, base UOM, purchase UOM, sales UOM, and price UOM as KG; pieces per pack is 1 and tile coverage is not accepted.
- The quote API reasserts KG even if a stale or incorrect client payload attempts another UOM.

## User-interface verification

- Desktop Tile Studio showed `MRP / SQFT`, 31.00 SQFT derived coverage, and Chemical `MRP / KG`.
- NRP and special-pricing controls measured 194 px input + 261 px mode selector at 1200 px desktop width.
- At 390 px mobile width the same controls measured 106 px + 152 px, and document/body scroll width remained 390 px (no horizontal overflow).
- CP & Sanitary search for a Tile returned the guided cross-family message instead of an add action.
- Permanent delayed-cost page showed an already-received `COST PENDING` line and retained its editable supplier-rate control.
- Browser console verification returned zero errors.

## Automated acceptance evidence

- `npm run build`: Nest API and all 57 Next.js routes compiled, linted, type-checked, and prerendered successfully.
- `npm run smoke:pricing-matrix`: 5 tax rates × 3 pricing bases passed under `unified_retail_v1`.
- `npm run smoke:quote-families`: Tile + Chemical GST quote and CP/Sanitary without-GST quote created, filtered, family-isolated, and rendered as substantive PDFs; forced Chemical KG contract passed.
- `npm run smoke:po-cost-contract`: optional PO rate, optional inward rate, delayed post-inward cost, PO discount/GST normalization, exact lot/GRN update, no stock quantity change, and permission override all passed in an isolated acceptance database.
- All 42 migrations applied successfully to a fresh isolated database before acceptance.

## Sample customer documents

- [Tile and Chemical quotation](samples/2026-08-26-quote-families/SAMPLE_TILE_AND_CHEMICAL_QUOTATION.pdf)
- [CP and Sanitary quotation](samples/2026-08-26-quote-families/SAMPLE_CP_AND_SANITARY_QUOTATION.pdf)
- [Purchasing, pricing, and lot-cost user guide](../../apps/web/public/help/Marble-Park-Purchasing-Pricing-Cost-Guide.pdf)

Each sample is a one-page A4 customer quotation. The PDFs expose MRP, final selling price, quantity/rate UOM, and amount only; NRP, internal discounts, floor price, cost, and savings remain hidden.

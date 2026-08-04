# Quote Pricing and Operations Plan Completion

Date: 4 August 2026
Scope: `IMPLEMENTATION-PLAN.md`
Branch: `codex/production-ready-client-flows`

## Delivered contract

- Quote-line MRP is tax-inclusive, basis-aware (`PIECE`, `PACK`, or `AREA`), separately stored from Product Master List Rate and the negotiated rate, and audited by user and timestamp.
- Incomplete pricing can be saved as a draft. Confirm, approval, PDF, share, and Sales Order conversion remain blocked until pricing is complete.
- Structured MRP failures identify the line and field, preserve entered data, provide remediation, and expose the maximum valid pre-tax rate when the ceiling is exceeded.
- Quote creation and detail screens include pricing KPIs, missing-value queues, Product Master links, bulk verified-MRP use, GST/non-GST treatment, quote discount, basis invalidation, responsive line cards, and a mobile action bar.
- Quote PDFs show MRP savings and reconcile to the validated commercial snapshot.
- Full and partial Sales Order conversion preserve MRP, List Rate, negotiated rate, basis, tax, and confirmation provenance.
- Sales Orders, Reserved/Dispatch, and Inventory use bounded server-side read models with filters, stable sorting, cursor pagination, saved views, CSV export, aggregate KPIs, exception states, source evidence, and next-valid actions.
- Inventory location filters and KPIs aggregate the selected location's active lot balances, not the company-wide product balance.
- The schema migration adds first-class MRP provenance and relational/index support without guessing historical MRP values.

## Verification evidence

| Gate | Result |
| --- | --- |
| API production build | Passed |
| Web production build | Passed; 48 routes generated |
| Pricing matrix | Passed; GST 0/5/12/18/28, invalid MRP cases, PC/BOX/AREA, structured errors |
| Release contract | Passed; blocked missing MRP, incomplete draft, provenance, quote to Sales Order to pending inward |
| Production lifecycle | Passed; Product Master, GRN, count, quote, order, dispatch, return, final stock |
| Tile pricing | Passed; AREA, PIECE, BOX, and partial Sales Order |
| Quote/procurement assets | Passed; PO optional cost fallback, GRN, managed remote image, brands, quote/PO/SO PDFs and sharing |
| Branded documents | Passed; GST and non-GST PDFs with product and brand images |
| Customer accounts | Passed; invoice, receipt, allocation, statement balance |
| Inventory location reconciliation | Passed; API MAIN totals exactly matched PostgreSQL lot balances |
| Control-tower scale | Passed; 10,000 Sales Order lines and 500 inventory lots, query plans measured, transaction rolled back |
| Product import scale | Passed; 600-row preview/apply workflow |
| Responsive browser QA | Passed at 1440 px and 390 px for Orders, Dispatch, Inventory, and Quote; no horizontal overflow or console errors |
| Database migration | Passed locally; 24 migrations and schema current |

Scale evidence is retained in `evidence/control-tower-scale-gate.json`. Responsive screenshots are retained in the same evidence folder.

## Data-quality signals

The system does not manufacture missing commercial facts. Existing products without List Rate or cost remain visible as explicit completion exceptions. Those source values require business-owner correction through Product Master or the reviewed Excel flow; they are not application defects and are not silently replaced by MRP or negotiated price.

## Release conclusion

The accepted quote-pricing and operations-control-tower plan is implemented in one compatible schema/API/web release. The release remains subject to the normal production deployment gates: backup, migration, service health, live contract smoke, and deployed-source verification.

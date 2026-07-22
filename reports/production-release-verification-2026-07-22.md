# Marble Park ERP Production Release Verification

**Release date:** 22 July 2026  
**Application:** [https://65-1-24-110.sslip.io](https://65-1-24-110.sslip.io)  
**Application release:** `a92a8b2` (`fix: harden product imports quotes and catalogue scaling`)  
**Branch:** `codex/production-ready-client-flows`  
**Pre-deployment backup:** `/srv/marble-park/backups/20260722T082955Z`

## Release Decision

The flagged product-master, Excel-import, quote-editing, branding, catalogue-performance, stock-lifecycle, procurement and dispatch paths passed the release gates described below. The AWS deployment is healthy, its database is at all 20 migrations, deployed source hashes match the committed release, and scoped test records were removed after verification.

This is a production-readiness statement for the tested scope, not a claim that any non-trivial system can never encounter a future defect. Errors remain traceable through Apollo action/code/field/reference details and server request IDs.

## Flagged Issues And Resolutions

| Area | Root cause | Production resolution | Verification |
|---|---|---|---|
| Quote editor error after order creation | The editor sent presentation changes through the commercial `UpdateQuote` mutation. Commercial terms must be immutable once an order exists. | Added a separate `UpdateQuotePresentation` contract. Cover, room/product images, terms, brand selection and PDF layout remain editable; quantity, rate, discount and GST changes require **Revise quote**. The UI now explains the lock before submit. | Live test saved presentation data after conversion and confirmed a commercial mutation is rejected without changing confirmed data. |
| Product/master pages became slow as lists grew | Pages fetched and rendered the full product collection, repeated image work and searched on every keystroke. | Added server-side `skip/take` pagination, page sizes of 36/50, a 200-row API cap, 300 ms deferred search, single lazy image rendering and PostgreSQL trigram indexes for SKU, internal code, name, brand and alias searches. | Desktop/mobile QA passed; production migration `20260722090000_product_search_trigram_indexes` is applied. |
| Excel importer appeared stuck or inconsistent | Browser conversion, full-list rendering and review-state mutation made large workbooks expensive; review/apply state was not cryptographically tied to the uploaded workbook. | Added chunked browser upload, server-side signed preview sidecars, uploader/file/token integrity checks, indexed master lookups, editable row patches, 50-row review pagination and chunked database writes. Apply is enabled only after validation and explicit review. | Live master/image/inward test passed. A 600-row workbook previewed in 597 ms and applied in 1,186 ms, creating 600 rows before self-cleanup. |
| Workbook fields and images were unclear | Required and optional columns were not explicit enough and image behavior was difficult to verify. | The generated template now contains live database lists and dropdowns for categories, brands, finishes, materials, tile sizes, UOMs, tax codes and Yes/No fields. Optional columns are marked; embedded worksheet images are associated with their SKU rows. | Live template exposed 7 categories, 21 brands, 7 finishes, 13 materials, 4 tile sizes, 8 UOMs and 5 tax codes. Embedded-image intake and editable correction both passed. |
| Product image/brand logo absent in quote PDF | Legacy company branding and some brand references pointed to dark or unsuitable assets; PDF rendering did not consistently use the canonical asset. | Installed the supplied Marble Park artwork as canonical full and square PNG assets; updated shell, login, settings, share pages, quote editor/PDF, PO, dispatch slip and help guide. Legacy company-logo values are normalized by migration. | Public logo returns HTTP 200 as `image/png`; quote PDFs rendered the company logo, three selected brand marks and product images. |
| GST-only quotation | Tax treatment was coupled to the quote total path. | Preserved explicit GST and non-GST quote modes and made both PDF paths part of the release gate. | GST PDF: 322,538 bytes. Non-GST PDF: 321,391 bytes. |
| Tile pricing and stock identity | Area, box and piece concepts could be confused with physical stock lots. | Quote lines support pieces, boxes and area billing while inward remains lot-based. Tile test used 7 boxes and billed 108.5 SQFT. Display labels remain separate from physical stock; GRN creates the available lot. | Live import created GRN `GRN/2026/0012`, lot `GRN/2026/0012-001`, on-hand 4, two lot labels and one display label without changing stock. |
| Pending items, PO and dispatch documentation | These downstream documents needed a full executable gate. | Verified pending purchase demands, direct and demand-backed POs, PO PDF, GRNs/lots, allocation, partial dispatch, dispatch-slip PDF, OTP delivery proof, return and lot restoration. | Live PO `PO/2026/0007`, direct PO `PO/2026/0006`, 95,240-byte PO PDF; pick `PK/2026/0004`, challan `CH/2026/0004`, 96,180-byte dispatch PDF and return `RT/2026/0003`. |
| Generic Apollo failures | Raw status text did not identify the operation or safe next action. | Apollo errors now expose action, code, field and copyable reference while avoiding duplicated page/toast errors. Domain errors explain whether to correct fields, revise a quote or retry. | The locked-quote gate produced the intended business rejection and no duplicate UI failure state. |

## End-To-End Evidence

### Sales And Stock Lifecycle

The production release gate completed:

1. Direct quote creation with automatic lead/customer context.
2. Quote revision and approval.
3. Partial conversion of one quote into two sales orders.
4. Idempotency checks preventing duplicate conversion.
5. Reservations, purchase demands, receipts and dispatch jobs.
6. Presentation-only quote update after order creation.
7. Commercial-field freeze after order creation.
8. Residual quote close.
9. Pending demand to PO and direct PO creation.
10. GRN receipt into five lots, lot reservation and stock accounting.
11. Pick, partial dispatch, challan/slip generation, OTP proof, return and stock restoration.

Observed stock after procurement and allocation was `onHand=6`, `reserved=5`, `damaged=1`, `available=0`, which reconciles correctly.

### Product Import And Labels

- Downloaded a template populated from live master data.
- Detected and corrected one invalid review row.
- Ingested one embedded product image.
- Created the SKU with zero stock.
- Created physical stock only through GRN and lot receipt.
- Generated lot and display QR labels.
- Confirmed display labelling does not mutate physical stock.
- Blocked an invalid row and protected an existing SKU from accidental overwrite.
- Created and cleaned 600 SKUs in the scale gate.

### Quote And PDF Rendering

- Company logo uses the client-supplied red/black Marble Park artwork.
- Selected brand logos appear in the quote footer.
- Product images render in item rows.
- GST and non-GST totals render independently.
- Tile box quantity and area billing coexist in the same quote.
- Purchase-order and dispatch-slip PDFs open as generated documents.

## Build, Security And UI Gates

| Gate | Result |
|---|---|
| Clean dependency install | Passed |
| API TypeScript/production build | Passed |
| Next.js production build | Passed, 48 routes |
| Production dependency audit | Passed, 0 known vulnerabilities |
| Desktop importer/Product Master/Tile Master/locked quote QA | Passed |
| Mobile importer/Product Master/Tile Master/locked quote QA | Passed; no overlap or console errors observed |
| Local full workflow, import, 600-row scale, quote/PDF and procurement gates | Passed |
| AWS full workflow, import, 600-row scale, quote/PDF and procurement gates | Passed |

Dependency hardening includes Next.js `15.5.21`, direct `sharp 0.35.3`, `body-parser 2.3.0` and `brace-expansion 2.1.2` pins in the committed lockfile.

## Deployment Verification

- `marble-park-api-1`: healthy
- `marble-park-web-1`: healthy
- `marble-park-postgres-1`: healthy
- `marble-park-caddy-1`: running with HTTPS
- `/healthz`: `200`, API status `ok`
- `/readyz`: `200`, API status `ready`
- `/api/health`: `200`, web status `ok`
- `/brand/marble-park-logo.png`: `200`, PNG, 137,440 bytes
- Prisma: 20 migrations found; database schema up to date
- Release marker: `a92a8b2`
- Local/remote SHA-256 matches: company logo, quote service and `package-lock.json`
- Recent API/web logs: clean startup, no application exception or fatal error
- Root filesystem: 77 GB total, 44 GB free after deployment

Caddy reports informational host-level HTTP/3 UDP-buffer and OCSP-stapling warnings; HTTPS, HTTP/2 and application traffic are working normally. These are not application failures.

## Data Hygiene

Release tests used namespaced `CLIENT-FLOW` and `@example.test` records. Cleanup removed the retained workflow data, including quotes, orders, POs, GRNs/lots, reservations, challans, returns, notifications and audit events. Two final cleanup passes reported zero matching synthetic products, customers, quotes, orders, purchase orders, lots, challans or returns.

## Operational Notes

- Product Master defines saleable identity; opening stock or GRN creates physical inventory.
- Display QR labels identify showroom samples and do not increase stock.
- Commercial quote changes after order conversion require a revision; layout and presentation remain editable on the confirmed quote.
- Import users should always download a fresh template so dropdowns reflect current master data.
- The deployment backup above must be retained until the client completes acceptance testing.

## Final Status

**Release gate: PASSED.** The reported defects are resolved in the deployed release and the tested business chain is operational from Product Master and Excel intake through quotation, partial sales conversion, purchase, inward, lot/QR tracking, partial dispatch, delivery proof and return.

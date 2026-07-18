# Marble Park Product Import Incident Review

Date: 18 July 2026
Scope: Attached workbook, screenshot, current repository implementation, isolated AWS route, and legacy Railway route.
Change policy: Incident review plus importer and lifecycle remediation. Railway was not changed.

## Executive finding

The screenshot is not showing sixty bad products. The attached workbook contains exactly four populated Product Master rows. The screen is the legacy Railway importer, which incorrectly scans support sheets such as `Live Master Lists`, `How to use`, and `Reference details` as if they contain products. This generated approximately sixty false row failures.

The isolated AWS code line now includes the parser correction, master-data preflight, editable server-validated review, create-only atomic apply, explicit required fields, and the downstream zero-stock-to-GRN/QR lifecycle. The two environments are still publicly reachable, so users can enter the wrong system and receive materially different import behavior.

No import was applied in the screenshot because the legacy screen reports that Apply is locked.

## Evidence

### Environment mismatch

| Environment | Import screen detected | Result |
|---|---|---|
| `https://65-1-24-110.sslip.io/dashboard/master-data/imports` | `Create clean Product Master SKUs in bulk` | Current create-only, governed importer |
| `https://web-production-30835.up.railway.app/dashboard/master-data/imports` | `Preview first. Apply only after the sheet is clean` | Legacy create/update importer shown in the screenshot |

The screenshot labels and controls exactly match repository commit `6f13f96`, including `Upload Excel catalogue`, `Create`, `Update`, `New categories`, and `Apply clean preview`. They do not match deployed importer commit `62d6e37`.

### Workbook structure

| Sheet | Used range | Purpose |
|---|---:|---|
| Product Master | `A1:F5` | Four actual product rows |
| How to use | `A1:C10` | Instructions only |
| Live Master Lists | `A1:H14` | Dropdown source data only |
| Reference details | `A1:D44` | Master-data reference only |

The workbook has no formulas with visible errors and no embedded product images.

## Actual product rows

| Excel row | SKU | Internal code | Product | Category | Brand | Finish | Finding |
|---:|---|---|---|---|---|---|---|
| 2 | `SPJ-CHR-15463PM` | `JQ` | BUTTON SPOUT | Faucets | JAQUAR | Chrome | Brand is not in the downloaded live Brand list |
| 3 | `FLR-CHR-5273PM` | `JQ` | WALL MIXER | Faucets | JAQUAR | Chrome | Duplicate internal code `JQ`; brand is not governed |
| 4 | `4563250` | `GR` | DIVERTER | Faucets & Showers | GROHE | Brushed Nickel | Numeric SKU cell; brand is not governed |
| 5 | `123351` | `AQ` | SHOWER | Faucets & Showers | AQUANT | Black | Numeric SKU cell; brand is not governed |

The downloaded template contains zero brands in `Live Master Lists`. JAQUAR, GROHE, and AQUANT were typed or pasted manually, so the current governed importer will reject them until the brands exist in Brand Master.

## Findings by severity

### Critical: the workbook was uploaded to the obsolete environment

The legacy importer loops through every worksheet and treats every encountered row as product input. It also allowed existing SKU updates and automatically created missing category, brand, and finish masters. This explains both the sixty false errors and the `3 Create / 1 Update` summary.

Operational risk: a clean-looking legacy preview could overwrite an existing product with incomplete Excel values or create typo-based master records. Staff must not use the Railway importer for Marble Park production.

### High: brand-master onboarding is incomplete

The production template correctly reflects the database, and that database currently exposes no brands. The importer therefore offers an empty Brand dropdown while the business cannot realistically create branded products without first configuring Brand Master.

Required operating sequence:

1. Create JAQUAR, GROHE, AQUANT, and every other approved served brand in Brand Master, including correct names and logos.
2. Download a fresh Product Master workbook.
3. Select brands from its dropdown instead of pasting uncontrolled text.

### High: internal code is being used as a brand abbreviation

`JQ` appears on two separate products. The current data model treats Internal Code as a unique showroom/product lookup identifier, not a brand code. Each design/SKU needs a distinct internal code, for example `JQ-BS-001` and `JQ-WM-001`. The Brand field already carries JAQUAR.

### Resolved: template instructions and backend acceptance rules disagreed

The UI says UOM and tax are required, but the parser silently defaults blank rows to `PC / PC / PC`, one piece per pack, zero coverage, `GST_18`, and zero price. All four attached rows leave columns G through V blank. Once brand/internal-code issues are corrected, they could therefore be created with assumed commercial values.

This was unsafe for production master data. The backend now requires explicit Base UOM, Purchase UOM, Sales UOM, Pieces per Pack, Tax Code, Allow Loose, and positive Sell Price. Missing inputs remain blank in the review editor until the user chooses them.

### Resolved: SKU columns were not forced to Excel Text format

Two SKUs are stored as numeric cells. The generated workbook now formats both SKU and Internal Code columns as Excel Text, while the server continues to normalize and validate identifier syntax and uniqueness.

### Medium: workbook has no product images

No embedded images or Image URLs are present. This is not a parser error because images are optional, but these products will have no catalogue/quotation image unless images are added during import or later in Product Master.

### Resolved: zero-brand templates needed a stronger preflight gate

The importer now checks active categories, brands, finishes, tile sizes, UOMs, and tax codes before template download or upload. Missing required masters block the workflow and link to the relevant master page.

## Implemented remediation

| Control | Implemented behavior |
|---|---|
| Live preflight | Required master counts are fetched from the current database; template and upload remain disabled until ready |
| Fresh template | Dropdowns come from active masters, identifier columns are Text, and required fields use Excel validation |
| Safe parsing | Only Product Master or strongly matching product sheets are read; support tabs are ignored |
| Editable review | Every source row can be corrected against live master options before any database write |
| Signed confirmation | The HMAC confirmation binds the uploaded workbook and the exact canonical reviewed values; changed edits require revalidation |
| Atomic creation | The entire workbook is create-only and all-or-nothing; existing SKUs cannot be overwritten |
| Unique identity | SKU and normalized internal/showroom code are each unique in the workbook and database |
| Stock separation | Imported Product Master records start at zero stock; Opening Stock or GRN creates physical lots |
| Display separation | Showroom displays are non-sellable records and do not change stock balances |
| Error handling | Apollo errors distinguish expired session, permission, validation, network, and generic server failures |
| Legacy compatibility | A migration supplies the required default for legacy `PurchaseOrder.orderDate` columns without changing fresh normalized schemas |

## Verification evidence

| Gate | Result |
|---|---|
| Attached workbook in browser | Exactly 4 rows read; 4 genuine failures; no support-sheet rows |
| Browser edit/revalidation | Corrected first row changed result from `0 ready / 4 failed` to `1 ready / 3 failed`; apply stayed locked |
| Import lifecycle smoke | 1 edited row created, zero opening stock, 4-unit GRN, exact lot, 2 scannable lot labels, separate display label, no display stock change |
| Review tamper test | A confirmation token was rejected when reviewed Sell Price changed after validation |
| Tile pricing smoke | Area, piece, and box pricing passed; partial order retained physical box quantity |
| Partial quote/order smoke | One quote converted into two independent orders with correct remaining quantity and over-order protection |
| Procurement/lot smoke | PO, three GRNs, damaged quantity, FIFO reservation, and stock reconciliation passed |
| Dispatch/return smoke | Exact-lot pick, pack, challan, proof-required delivery, return, and lot restoration passed |
| Quotation smoke | Selected brand logos and tile pricing rendered into a 205,782-byte sample PDF |
| Build and UI | API build, 48-route Next production build, targeted lint, desktop/mobile browser inspection, and zero browser-console errors passed |
| Dependency audit | Clean `npm ci`, patched transitive overrides, rebuild, and `npm audit --omit=dev` with zero vulnerabilities passed |

## Current importer flow review

| Stage | Current AWS behavior | Review |
|---|---|---|
| Template generation | Reads active masters from the real database and creates dropdowns | Correct; empty-brand state needs stronger warning |
| Upload | Chunked `.xlsx`, 25 MB maximum, 5,000 product rows | Correct |
| Sheet selection | Accepts Product Master or strongly matching product sheets; skips support tabs | Correct and fixes this incident |
| Preview | No writes; validates SKU, unique internal code, governed masters, UOM/tax, pack conversion, price, and images | Correct |
| Existing SKU | Blocked and directed to individual Product Master editing | Correct; prevents destructive bulk updates |
| Confirmation | Signed preview token plus explicit user checkbox | Correct |
| Apply | All-or-nothing database transaction; creates zero stock balance | Correct |
| Images | Detects in preview, persists only on confirmed apply, validates type/size | Correct |
| Cleanup | Explicit discard and aged-upload cleanup | Correct |
| Stock creation | Product starts at zero; opening stock or GRN creates physical inventory/lots/labels | Correct separation of master and inventory |

## Safe interpretation of this upload

- False errors: rows labelled `Live Master Lists #...`, `Reference details #...`, or instructions are legacy-parser defects and should be ignored.
- Genuine data problems: no governed brands, duplicate internal code `JQ`, two numeric SKU cells, no explicit UOM/tax/pricing fields, and no images.
- Existing product: the old environment reports one matching SKU, but this only proves a match in that legacy database. It does not establish the state of the isolated AWS database.
- Database writes: none occurred in the screenshot because Apply was locked.

## Recommended correction order

1. Use only the isolated AWS URL for Marble Park.
2. Add approved brands and logos in Brand Master.
3. Download a new live template after master setup.
4. Assign a unique internal showroom code to every product.
5. Enter explicit UOM, pack, tax, sell-price/floor-price policy, and images where required.
6. Upload to AWS, verify that Rows Read equals 4, review every row, then confirm.
7. After SKU creation, use Opening Stock or GRN for physical stock and label/QR generation.

## Conclusion

The sixty-error result was primarily an environment/version incident. The attached workbook also has genuine master-data and completeness problems, and the corrected importer now exposes those exact problems without writing partial data or accepting silent defaults. The operating sequence is: complete masters, download a fresh workbook, use unique internal codes, review and revalidate every row, create zero-stock SKUs, then receive opening stock or GRN lots and print the appropriate stock or display labels.

# Tile label size and same-design scanning — 11 September 2026

## Changes

- Tile labels now show a small 7 pt size line directly below the product/design value. Only the physical face dimensions are printed, for example `1200 x 600 mm`; pack counts, descriptions and other metadata are excluded.
- Non-tile labels do not gain a size line. Existing brand-code-only, design/product, finish, direct rate, rate UOM and QR rules remain intact. No GRN, lot or tax wording was reintroduced.
- Both exact-size landscape (101.6 × 50.8 mm) and portrait (50.8 × 101.6 mm) layouts reserve space for the size. The browser grid is explicitly constrained so long content cannot enlarge the sticker's internal columns or rows. Product text remains limited to two fitted lines; unprintably long values are rejected rather than silently losing information.
- A tile scan prominently shows its design and registered size/finish variants. Size filter buttons make alternatives easy to find. The scanned SKU is initially selected; selecting or clearing the displayed options preserves selections hidden by a filter. Zero-stock variants remain selectable for sales intent.
- The shared selector is used by lead/intention creation, existing sales intents, quote building and Labels & Scan. Existing backend checks still reject inactive and unrelated-design selections.

## How sales should use it

1. Scan the registered physical label in the existing sales/quote scan flow.
2. Check the design heading and the **Physically scanned** item.
3. Choose a size filter to see other registered variants of that same design. Select individual variants or **Select shown**.
4. Use **Add to intent** or the action provided by the current page. Selecting more sizes does not change the original scanned identity.
5. For printing, open a current 4 × 2 print run or prepare a new one. The size is loaded from the tile master data automatically. Use the matching paper dimensions and actual-size printing.

## Verification evidence

- API and web production builds passed; TypeScript/lint and 58 Next.js routes passed.
- `verify-tile-label-size-scan.cjs`: tile-only normalization, removal of pack details, master-size precedence, same-design lookup, zero-stock selection, selected-ID audit metadata and cross-design rejection passed.
- `verify-4x2-label-renderer.mjs`: fixed geometry, constrained text/grid, tile size and forbidden-field checks passed.
- `verify-labels-pdf.mjs`: six pages per orientation, real duplicate copies, exact PDF media sizes, four QR decodes from rendered pages, expected text and forbidden-field checks passed. The deliberate 220-character overflow fixture was rejected as expected.
- Visually inspected four rendered PDF samples, including the reported ARORA ARAMANI COCO name and a longer product value, in both orientations.
- Browser harness uses the actual shared selector, sticker JSX, CSS and text-fitting function. Six tested sticker frames had no descendant crossing the outer boundary. Only four tile frames had size lines; the two sanitaryware frames did not.
- Browser interaction: filtered to 1200 × 2400, selected that zero-stock variant, and **Add to intent** returned both the original scanned item and the additional size. Phone-width layout was inspected as well.
- Read-only deployed-service check used actual production data: all **290 active tile SKUs** yielded a normalized size. A real ROSSO LEVANTO label returned 1200 × 600, 1200 × 1800 and 1200 × 2400 mm variants. Its rendered payload used design ROSSO LEVANTO, brand code 1052, finish Lappato Matt and SQFT rate basis. The scan audit writer was substituted in memory for this diagnostic; **zero scan audit or business writes** occurred.

## Release

- Label, sizing and selector changes: `5fd2b9d`.
- Heading contrast follow-up: `9dd2b2f`.
- Production: `/opt/marble-park`, https://65-1-24-110.sslip.io.
- Final deployed source revision: `9dd2b2fc`; API and web containers rebuilt/recreated and healthy.
- Post-deploy public checks at 2026-09-11 12:39 UTC: `/readyz` returned `ready`; `/api/health` returned `ok`.
- API image: `sha256:6c6d7bd4e4f5121e13a64a1d2b5ce3fa9617332b2259a75ad244f3bea8b3be1e`.
- Web image: `sha256:2e333eb0e006e7c9b42cc2a1c2964a844c4cf87a8e3faef0bf0831da1afbbdbe`.
- Server filesystem remained at 87% utilization with approximately 11 GB available. No backups or business records were deleted.

## Acceptance boundary

Automated, rendered-PDF, local browser and read-only live-data checks are distinct from physical printer acceptance. No physical printer was controlled and no client-authenticated sales transaction was submitted during this release. Existing pricing, stock, permissions and transaction logic were not changed.

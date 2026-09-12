# Tile size beside brand - 12 September 2026

## Requested change

Moved tile dimensions to the empty upper-right area beside the brand code, matching the client's marked screenshot. Removed the size beneath the product/design value. This supersedes the size placement in the 11 September report.

## Implementation

- Browser print and PDF output both place the dimensions beside the brand and above the product.
- Preferred size type increased from 7 pt to 10 pt bold, with measured fitting inside its own bounded column.
- Tile dimensions remain tile-only, with no pack count, description or extra metadata.
- Product text retains its fitted two-line area; finish, direct rate, UOM, QR, brand code and exact sticker dimensions are preserved.
- Landscape and portrait remain supported, with one sticker per page and duplicate copies retained.
- Web-only change. No API, database, pricing, scan-selection or business-flow changes.

## Checks

- Production web build: passed TypeScript/lint and generated all 58 routes.
- Label renderer regression: passed, including the new above-product/right-of-brand position contract.
- PDF regression: passed two six-page orientations, exact 4 x 2 / 2 x 4 media sizes, four rendered QR decodes, duplicate pages, finish/rate/forbidden-field checks and deliberate overlong-value rejection.
- PDF visual inspection: landscape and portrait, ordinary and long product names, no overlaps or missing fields.
- Browser fixture using actual production JSX/CSS/fitter: all six sticker frames had zero out-of-frame descendants. All four tile instances placed their size beside the brand and above the product at 10 pt; both sanitaryware instances omitted size.
- The browser fixture is test-only and is not a production label or scan identity.

## Release

- Code commit: `43fda77` on `notification-workspace`.
- Deployed source revision: `43fda77f` in `/opt/marble-park`.
- Web image: `sha256:4970baa4105205b2d2218cda456e1239ba3276ba34e03ce708fa8436c557cc3a`.
- API and web containers healthy; public `/readyz` returned `ready` and `/api/health` returned `ok` at 2026-09-12 06:30 UTC.
- Running web container's browser-renderer and PDF-renderer file hashes exactly matched the tested checkout.
- Refresh the current print preview or download a new PDF to see the new placement. Previously downloaded files are unchanged.
- Operational observation: root storage is 92% used, with 6.7 GB available. No backup or data cleanup was performed in this layout-only release; capacity management remains a separate follow-up.

Physical printer output remains a device acceptance check; a printer was not operated during this release.

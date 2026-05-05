# Master Brand/Finish and Import Review Patch - 2026-05-01

## Scope Completed

- Added first-class `ProductBrand` and `ProductFinish` master tables beside `ProductCategory`.
- Added GraphQL master APIs:
  - `masterProductBrands(status)` / `saveProductBrand(input)`
  - `masterProductFinishes(status)` / `saveProductFinish(input)`
- Product create/update now auto-registers category, brand and finish masters when needed.
- Product create/update now accepts `media`, enabling manual SKU images to become catalogue/gallery images.
- Product Master UI now uses dropdowns for category, brand and finish.
- Product Master UI now supports SKU image upload into `/catalogue-images/manual/*`.
- Added separate Brand Master and Finish Master module pages.
- Import Center now opens batch rows and allows row-level review.
- Import rows missing SKU, name, brand, category or finish are marked `needs_review`.
- Import batch submission for owner approval is blocked while any row is `needs_review`.
- Import review UI exposes dropdowns for brand, category and finish so parser gaps can be fixed before approval.
- PDF image extraction was run against the Aquant catalogue; extracted images were staged and one image task was submitted for owner approval.

## Verified Locally

- `npm run db:generate` passed.
- `npm run db:push` passed and created/synced the new master tables.
- `npm run build:api` passed.
- `npm run build:web` passed.
- `node scripts/regression-smoke.mjs` passed.
- `node scripts/e2e-retail-flow-smoke.mjs` passed with quote `QT/2026/0013` and challan `CH/MOMQ0FNW`.
- Focused master/import smoke passed:
  - created brand `Smoke Brand 18761B`
  - created finish `Smoke Finish 18761B`
  - created category `Smoke Category 18761B`
  - created SKU with persisted media
  - staged Excel row as `needs_review`
  - confirmed submit was blocked before master review
  - saved row review and submitted batch `01KQHEHK0WW4824RRSKMQ4FF9T` for owner approval
- PDF extraction smoke passed on `Aquant Price List Vol 15. Feb 2026_Searchable.pdf`:
  - staged `386` rows
  - extracted `11` image review tasks
  - submitted extracted image task `01KQHEJZ7NC1VZ1VCK6YTP8894` to owner approval mapped to `HIN-20076`
- Browser verification passed on:
  - `/dashboard/master-data/products`
  - `/dashboard/master-data/imports`
  - `/dashboard/quotes/approvals`

## Current Owner Review Queue Added For Inspection

- Import approval: `01KQHEHK0WW4824RRSKMQ4FF9T`
- Catalogue image approval: `01KQHEJZ7NC1VZ1VCK6YTP8894`
- PDF image URL: `/catalogue-images/imports/aquant-price-list-vol-15-feb-2026-searchable-p12-c26c55f7a112.png`

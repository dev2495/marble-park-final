# 4 x 2 label layout fix — 2026-09-11

## Outcome

The current thermal 4 x 2 label renderer now keeps the governed product/design value inside its fixed detail area. Product values use conservative size thresholds and a two-line maximum in the browser preview; the server PDF renderer applies the same bounded sizing and blocks values that cannot fit legibly instead of allowing a product name to push finish or rate outside the sticker.

Existing label rules remain unchanged: QR, label code, brand code, product/design value, finish, direct rate and rate UOM are printed. Brand name, MRP/GST/tax wording, GRN and lot details remain excluded.

## Verification

- `scripts/verify-4x2-label-renderer.mjs` — passed.
- `scripts/verify-labels-pdf.mjs` — passed: landscape and portrait exact-size pages, six-page duplicate fixture, QR decode checks, finish/direct-rate checks, forbidden-field checks, legacy-template rejection, external-image rejection, and overlong-value blocking.
- `npm run build:api` — passed.
- `npm run build:web` — passed (58 routes).
- Rendered PNG inspection — passed for landscape, portrait and a two-line long-product fixture; no text crosses the fixed detail/rate boundaries.

## Production rollout

- Commit: `3bb2087` (`Constrain product values within thermal sticker layout`)
- Production checkout: `/opt/marble-park`
- Production revision: `3bb2087a`
- API and web containers rebuilt and recreated with the existing rollback tags preserved.
- `https://65-1-24-110.sslip.io/readyz` — HTTP success, `status: ready`.
- `https://65-1-24-110.sslip.io/api/health` — HTTP success, `status: ok`.
- Prisma startup — `No pending migrations to apply.`
- Post-deploy disk — 15 GB free (82% used).
- Post-deploy counts observed: 1,161 products, 23 quotes, 10 sales orders, 24 purchase orders, 109 GRNs, 467 inventory lots and 11 customers. These are observations only; no business data was changed by this release.
- Notification delivery health: pending `0`, failed `0`, unrouted `0`; worker heartbeat observed at `2026-09-10 19:12:17 UTC`.

## Acceptance boundary

The release is source-, PDF-, build- and runtime-verified. A client-owned signed-in browser print preview and a physical printer sample remain the final device/printer acceptance step; Safari was observed on the AWS Console and did not expose a Marble Park app tab for that check.

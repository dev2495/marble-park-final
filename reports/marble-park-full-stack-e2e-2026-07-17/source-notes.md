# Marble Park full-stack E2E evidence notes

## Scope

- Environment: isolated Marble Park AWS Lightsail production stack at `https://65-1-24-110.sslip.io`
- Test window: July 17, 2026 IST
- Baseline snapshot: `/srv/marble-park/backups/20260716T211601Z`
- Cleanup: checksum-verified database and asset restore after browser verification

## Local release gates

- API NestJS production build: passed
- Next.js optimized production build: passed, 47 routes generated
- Workspace lint: passed with zero errors; six pre-existing API unused-variable warnings
- All E2E script syntax checks: passed

## Live scenario outputs

- RBAC: temporary owner delegation, per-user Product Master and user-management overrides
- Product import: 2 rows ready, 2 applied, 1 invalid row blocked
- Client workflow: `QT/2026/0001`, `SO/2026/0001`, `SO/2026/0002`
- Procurement: `PO/2026/0001`, 3 GRNs, 5 lots, accepted/damaged separation
- Dispatch and return: `PK/2026/0001`, `CH/2026/0001`, OTP proof, `RT/2026/0001`
- Finance retry: one return, one credit note, one GRN under duplicate retries
- Tile area pricing: 100 sq ft plus 10% wastage produced 8 boxes and 124 sq ft billed coverage; 3-box partial order billed 46.5 sq ft
- Production hardening: readiness 96, posted stock count, exact-lot pick, OTP delivery, return, reconciliation
- Multi-round CRM: quote v1 superseded by v2; follow-up intent and new-project branch retained
- Lead/intent/order: real sanitaryware and tile Product Master rows reached quote, PDF, order and partial dispatch
- Quote notifications: priced and selection PDFs, three quotes on one lead, stock-ready notifications, partial dispatch

## Defects found and corrected

1. Lead and intent tile normalization deleted Product Master identity, conflicting with quote enforcement. Both services now preserve active Product Master identity and inventory tracking.
2. Operations resolver pagination arguments were inferred as GraphQL Float. All `take` arguments now explicitly use GraphQL Int; the reconciliation page changed from HTTP 400 to 24 checked, 24 OK.
3. AWS had backup automation but no repeatable restore command. `deploy/aws/restore.sh` now validates checksums and restores database plus assets with controlled service shutdown/startup.

## Browser evidence

- Quote editor showed sanitaryware and tile rows, editable quote-image fields, GST totals and order history.
- Pending Inward showed the tile shortage linked to procurement, dispatch and lead trail.
- Labels & Scan listed exact GRN and count lots as label sources.
- Dispatch showed completed partial challans while pending-inward lines stayed outside pick lists.
- Reconciliation loaded with 24 checked, 24 OK, 0 warnings, 0 critical, and no console errors after the schema fix.

Screenshots are stored in `evidence/`.

## Cleanup proof

After restoring the pre-test snapshot: 1 user, 1 active owner, and 0 products, customers, leads, quotes, orders, GRNs, challans, returns, E2E-prefixed products or temporary E2E users. PostgreSQL, API, web and Caddy were healthy, and public health returned `ok`.

## Boundary

This validates software behavior and deployed integration. It does not replace client sign-off using authoritative masters/opening stock or physical printer, scanner, phone and tablet hardware.

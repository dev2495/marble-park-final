# Marble Park Release Verification

Date: 2026-08-04
Target: https://65-1-24-110.sslip.io
Branch: `codex/production-ready-client-flows`
Deployed application release: `5e1babe`

## Release scope

This release implements and verifies the production workflow work identified in the control-tower and quote review:

- MRP is captured per quote line and is required before approval, order conversion, and other commercial actions.
- List Rate is read from Product Master and remains distinct from the quote-entered MRP and negotiated rate.
- GST and non-GST quote treatment is supported, with tax-inclusive MRP validation.
- Quote, order, procurement, pending-inward, partial-order, partial-dispatch, and return paths share the same line and stock state.
- Orders, inventory, and dispatch have server-side search, filters, cursor pagination, and KPI summaries.
- Tile pricing supports area, piece, and box entry with conversion and billed-quantity snapshots.
- Product, quote, brand, and company images are retained for document rendering rather than relying only on an external URL at PDF time.
- Product-master Excel preview, editable validation, confirmation, bulk create, and downstream SKU-to-stock lifecycle are covered.
- Quote, sales-order, purchase-order, dispatch, label, and finance document paths were exercised.
- Backup retention works for both operator and systemd execution paths.
- High-severity dependency findings were removed from the lockfile; the remaining moderate finding is documented below.

## Implementation commits

| Commit | Change |
| --- | --- |
| `7ad5f07` | Quote MRP contract, shared pricing rules, downstream snapshots, and operations control towers |
| `a213b5b` | Backup retention fix for root-owned operator backup directories |
| `5e1babe` | Dependency lockfile hardening for `fast-uri` and `shell-quote` |

The three commits were pushed to `origin/codex/production-ready-client-flows`. The AWS deployment was rebuilt from `5e1babe`; the report-only documentation commit that follows this record does not change the runtime image.

## Verification evidence

### Local build and API checks

| Check | Result |
| --- | --- |
| `git diff --check` | Passed |
| `npm run build:api` | Passed |
| `npm run build:web` | Passed; all 48 Next routes generated |
| `npm run smoke:release-contract` | Passed; MRP block, quote, order, pending-inward state |
| `npm run smoke:production-hardening` | Passed; SKU, GRN, cycle count, quote, order, challan, return, readiness score 96 |
| `npm run smoke:tile-area` | Passed; area, piece, box, and partial-order pricing |
| `npm run smoke:branded` | Passed; product/brand images and GST/non-GST PDFs |
| `npm run smoke:readiness` | Passed; tile size, minimal SKU, inventory, Excel validation and create gates |
| `npm run smoke:import-scale` | Passed; 600-row preview in 208 ms and apply in 393 ms |
| `npm run smoke:document-vault` | Passed; upload, checksum, inline preview, range video, access, revoke, archive, restore, purge, audit |
| `npm run smoke:client-workflow` | Passed |
| `npm run smoke:quote-procurement` | Passed |
| `npm run smoke:quote-notifications` | Passed |
| `npm run smoke:multi-round` | Passed |
| `npm run smoke:rbac-users` | Passed |
| `node scripts/e2e-lead-intent-order-smoke.mjs` | Passed; lead to quote to order to partial dispatch and PDF |
| `node scripts/e2e-finance-idempotency-report-smoke.mjs` | Passed; return, credit note, GRN, report, and stock value |

The scale smoke creates isolated test records and verifies the response path. It does not replace a load test against a production-sized database.

### Live AWS checks

- `/healthz`: passed with API status `ok`.
- `/readyz`: passed with API status `ready`.
- `/api/health`: passed with web status `ok`.
- Docker Compose: API, web, PostgreSQL, and Caddy containers healthy/up.
- Prisma deployment: 23 migrations found, no pending migrations.
- MRP columns exist in both `QuoteLine` and `SalesOrderLine`.
- Live release-contract smoke passed with quote `QT/2026/0030`, order `SO/2026/0027`, and dispatch status `pending_inward`.
- Production owner seed completed for `dvrshthakkar@gmail.com`; no password is recorded in this report.
- The pre-deploy database/assets backup was created and restore-verified. Restore validation found 81 public tables and matching SHA256 checksums.
- Live login was checked in a fresh browser session. The client logo rendered, the root request returned 200, and no browser console errors were observed.

The old Railway instance was not modified.

### Browser workflow checks

The local production build was exercised at desktop and responsive widths for:

- Orders control tower: live order rows, KPI cards, server-side filters, PDF links, and no Apollo error.
- Inventory control tower: live stock KPIs, search/filter controls, and paginated balances.
- Dispatch workbench: reserved register, ready-to-dispatch state, and pending-inward visibility.
- Quote builder: required MRP field, Product Master List Rate display, tax treatment, line images, and brand selection.
- Quote detail: locked commercial terms after order creation, PDF, print, and share actions.
- Login: client logo and password-control surface.

## Data and workflow behavior

Product Master remains the identity layer. Creating a SKU does not create physical stock. Opening stock or GRN creates lot-backed stock; labels identify the lot/display record; reservation, partial dispatch, return, damage, and adjustment move stock through auditable ledger entries. A quote can contain a SKU with zero stock and route the unavailable quantity to procurement/pending-inward without fabricating availability.

For quotes, List Rate is the current Product Master sell-price reference. MRP is the commercial ceiling entered for the quote line. The negotiated rate is validated against the applicable MRP and the selected tax treatment. Once an order exists, commercial quote lines are frozen; a revision is required for a new commercial agreement.

## Known residuals and operating gates

1. The web image still reports two moderate PostCSS advisories through the nested dependency of Next `15.5.22`. The automatic remediation proposes the major Next `16.3.0` upgrade, so it was not applied without a full framework regression. No high-severity advisory remains, and the API image reports zero vulnerabilities. The npm cache/lockfile workflow used for the repair follows the documented [npm install behavior](https://docs.npmjs.com/cli/install/), [npm cache configuration](https://docs.npmjs.com/cli/v7/commands/npm-cache/), and [EACCES guidance](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/).
2. Existing historical master data may still have missing commercial prices or costs. The release validates and exposes missing pricing rather than inventing values. Before customer rollout, management should complete a price/cost completeness review and approve the source values.
3. Backup and restore were verified on-host. Off-host object storage retention and a scheduled restore drill remain recommended operational controls before treating the system as fully disaster-recovery compliant.
4. The executed smoke suite is broad and representative, but it is not a substitute for a sustained concurrent-user load test or a business-owner UAT sign-off using the final catalog.

## Release conclusion

No blocking failure was found in the implemented and tested scope. The AWS runtime is live on the release above, the critical quote-to-stock-to-dispatch paths are exercised, and the remaining items are explicit operational or upgrade gates rather than hidden failures.

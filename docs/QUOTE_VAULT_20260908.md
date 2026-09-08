# Quote register and vault fix — 8 September 2026

Status: locally implemented and verified; production deployment pending explicit target confirmation.

Production source was read from `/opt/marble-park` on 65.1.24.110 at clean detached commit `49a957d934f519abbbb670ed4b2fc2f14f79b667`. Its APP_HOST is `65-1-24-110.sslip.io`. The old Mac worktree has a broken Git pointer and was not used as the release base.

## Findings and fixes

- QT/2026/0047 has requestedArea 5, 6 and 2 in both the intent and quotation, with 1 box each and coveragePerPack 15.500031000048. Quantities were not lost: the register omitted the requested-area context. Show requested SQFT/PC, inventory quantity with its unit, and coverage/whole-pack rounding. Area-derived pack quantity is read-only; editing the request recalculates packs and pricing quantity.
- MRP was populated but inherited near-white text against a pale green input in dark mode. Explicit dark text now fixes the contrast in both themes.
- Register and PDF use one shared, stable case/whitespace-normalized section grouper. Nonadjacent matching sections merge without changing their source data. Different sections (Wall, Floor, HL) remain different. The repeated per-item area input is replaced by one section rename action and a per-item Move to section action.
- PDF tile descriptions include the requested quantity while retaining fulfilled boxes/pieces, total priced area and rates. Identical size text is not repeated when already contained in the product name.
- `documents.delete` is a separate permission, included by default for Admin/Owner and available in User Management overrides. Document managers do not gain permanent deletion automatically. A delete-only user with vault access can delete an already-archived asset without edit/share permission.
- Existing archive-first and confirmation safeguards remain. Users with only delete permission need a document manager to archive first. Deletion of the asset/share records and audit creation is transactional; file quarantine is restored on transaction failure. No customer vault files were deleted.

## Evidence

- API build and production web build/type checks passed.
- Existing unified retail pricing and product/brand-code smoke tests passed.
- `scripts/quote-vault-release-test.cjs` ran only against a newly created localhost disposable DB, with all 46 existing migrations applied. It checks role defaults, unauthenticated/unauthorized denials, archive prerequisite, override grant/revocation, database-failure restoration, actual binary removal, share cascade deletion, retained audit, normalized grouping and distinct-section preservation.
- Authenticated local browser at 390px: requested quantities 5/6/2, pack quantities 1/1/1, MRP 105; document width equals viewport width (390px). Dark-theme screenshot visually reviewed.
- Generated illustrative PDF was rendered and visually inspected: one section header, three rows, all requested quantities and commercial columns visible.
- Production backup `/srv/marble-park/backups/20260908T070842Z`: database and assets checksums passed; restore verification passed with 89 public tables. No schema migration is introduced by this patch.

## Deployment gate

The safety reviewer denied browser access to the sslip.io hostname because older task context names `erp.totalpolyprint.com`. Read-only SSH configuration corroboration did not clear the gate. Explicit user confirmation of the Marble Park hostname is required before deployment/live authenticated verification. No deployment or live-completion claim has been made.

After confirmation: recheck clean live HEAD, build/release via existing AWS deployment process, verify health and authenticated register/vault permission screens without deleting live files. Existing commercial values and records must remain unchanged. Backup retention is unchanged; permanent file deletion is not a promise to purge historical backups.

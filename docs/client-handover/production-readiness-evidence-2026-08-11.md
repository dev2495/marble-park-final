# Login and inventory hardening evidence — 2026-08-11

This addendum records the evidence for the Safari sign-in incident and the inventory source-of-truth release. It does not replace the broader 2026-08-10 handover gate.

## Authentication incident

- The screenshot request ID `ebcec26e-cdad-45af-816d-fec48f314147` was found in the live Caddy access log at 2026-08-10 18:29:21 UTC. The API returned a genuine `Invalid credentials` response; there was no throttle response or server exception.
- The named owner account exists, is active, and has the owner role. A host-side diagnostic confirmed that the current stored password hash matches the configured bootstrap owner password without printing either value. This disproves an application-side credential overwrite in that release and points to an older/wrong Safari AutoFill value.
- Login errors now distinguish failed credentials from an expired authenticated session. A no-cache `/reset-password` page accepts an operator-issued, cryptographically random, single-use one-hour token from the URL fragment, removes it from browser history, enforces a 12-character password, revokes all sessions on success, and preserves the existing password-reset audit lifecycle.
- With no approved mail provider configured, anonymous reset requests are intentionally inert and cannot replace a privately issued operator link. Enabling automatic delivery requires the explicit production flag plus the approved delivery implementation.
- Password-reset lifecycle and exactly-15-minute inactivity behavior passed isolated-database tests, including replay rejection, HttpOnly cookie bounds, CSRF protection, no background-poll keep-alive, explicit interaction keep-alive, logout revocation, and multi-tab browser behavior already covered by the client session layer.

## Inventory truth and reconciliation

- Physical stock writes converge through the lot posting transaction: opening stock, GRN/inward, stock count/adjustment, reservation/allocation, transfer, dispatch, and returns write immutable lot-ledger history and update active lot/location balance plus compatibility projections in one database transaction.
- Owner-facing inventory totals, availability checks, dispatch context, dashboards, quotes, and cost valuation now read active `InventoryLotBalance` quantities. Financial stock value uses active lot quantity × `InventoryLot.unitCost`; Product Master cost is not substituted as historical lot cost.
- The live read-only reconciliation covered 952 aggregate products and 292 lot/location rows. Aggregate and active-lot totals matched at 2,278 on hand and 2,252 available; reservation and backorder mismatches were zero; no negative or broken lot buckets were found. All 19 opening-stock sessions were posted, covering 270 posted lines and 2,234 opening units.
- The scan also identified a truthful readiness gap: 230 products representing 2,097 on-hand units have active legacy lots with a missing/non-positive unit cost. Their quantities remain reconciled, but complete stock-at-cost reporting is unavailable until inventory owners enter verified source costs. The inventory UI now exposes these as searchable `LOT COST MISSING` exceptions with a permissioned, reasoned, audited fill-only correction; an established positive lot cost cannot be overwritten by this action.
- Reconciliation now scans up to 5,000 products in one bounded owner action, aggregates ledger/reservation evidence in the database, and returns all exceptions or a 50-row clean sample. Normal high-volume lists remain paginated/bounded.

## Isolated release checks

- 32 migrations applied cleanly to the release-gate database.
- API and Web builds passed; lint passed without warnings; production dependency audit reported zero known vulnerabilities.
- Passed: authentication hardening, shortened inactivity timeout, inventory truth/cost, inventory location scope, production lifecycle, direct-order lifecycle, client workflow, shared labels/tiles, reporting suite, RBAC/users, 600-row import, and rollback-only 10,000-order-line/500-lot scale gates.

Production deployment still requires a fresh backup with restore verification, exact-source deployment, public health/readiness checks, an authenticated read-only smoke, live reconciliation, and a private user password reset handoff.

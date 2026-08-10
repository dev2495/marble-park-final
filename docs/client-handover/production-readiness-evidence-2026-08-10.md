# Production-readiness evidence — 2026-08-10

Status: **released and verified**. The last runtime-affecting application/security commit is `4473fc608f65e487e45601eb2c3eddb06c9010f5`; the primary authentication and client-readiness implementation is `900346e6242529263f3d2cb428a1722eb5fda0a7`. The canonical deployed checkout also contains this handover-only evidence update.

## Release evidence

| Gate | Result | Evidence |
|---|---|---|
| Authentication regression root cause and credential preservation | Pass | The previous production seed updated the existing bootstrap owner on every deploy. The seed is now create-only. The known-good credential state was selected from backup `20260810T125030Z`, restored into a temporary 85-table database, copied only for the configured owner without printing the hash, and recorded as `auth.credential.recovery`. Fifty-five stale owner sessions were revoked. A repeat production seed preserved the recovered hash/profile; verification matched the approved backup exactly. |
| Exactly 15-minute true inactivity | Pass | Production has exactly `SESSION_IDLE_TIMEOUT_MINUTES=15`; the API advertises 900 seconds with a 120-second warning and refuses another production value. A six-second test-only override proved background queries do not extend expiry, explicit meaningful-interaction keep-alive does, expired requests fail server-side, and logout revokes the record. Safari UI checks proved warning, stay-signed-in, idle redirect, and two-tab logout synchronization. |
| Session/cookie/CSRF/RBAC | Pass | Live HTTPS login returned `HttpOnly; Secure; SameSite=Lax; Max-Age=900`. Cross-origin cookie requests returned HTTP 403, production introspection was unavailable, and logout invalidated the session. Tokens are generated from 256 random bits and are not stored in browser local/session storage. Disabled/deleted-user, password reset/change, and role/permission revocation suites passed. |
| Database migrations and seed idempotency | Pass | All 32 migrations applied. A clean temporary database migrated successfully. The session migration bounded legacy session expiry at migration time plus 15 minutes. Repeated seed execution preserved the existing owner credential/profile. |
| Dependency and source security | Pass | Production builds, lint, dependency-tree validation, production dependency audit (zero known production vulnerabilities), and repository secret scan passed. GraphQL IDE/introspection is disabled; unsafe cookie requests are same-origin guarded; framework disclosure is removed; destructive reset is production-blocked. |
| Public-edge security | Pass | HTTPS serves CSP, HSTS, frame/MIME restrictions, cross-origin opener/resource policy, restricted referrer/permissions policy, no upstream server signature, and no-store login caching. Login HTML, CSS, JavaScript, and brand assets returned HTTP 200 after the security reload. |
| Commercial lifecycle and stock invariants | Pass | Lifecycle direct-order, client workflow, inventory location, labels/tiles, document vault, report, product-import, user/RBAC, and production-hardening suites passed against isolated data. No production commercial record was created or changed for smoke verification. Label stock remained `onHand=4`, `available=4`, `reserved=0` in the isolated acceptance flow. |
| Reports, labels, tiles, pagination, help | Pass | Owner/Sales/Finance/Inventory/Operations suite routes, source-backed report queries, setup guidance, paged customers/lots, search, exports/print contracts, label/tile flows, and help/PDF outputs passed API and desktop/mobile acceptance. The normal report journey does not expose the internal governed-definition count. |
| Backup and restore | Pass | Pre-release backup `/srv/marble-park/backups/20260810T154649Z` passed checksums and restored 86 public tables into a temporary verification database. The pre-regression credential recovery used `/srv/marble-park/backups/20260810T125030Z` without replacing current commercial data. The host environment was backed up at `/srv/marble-park/backups/.env-pre-900346e` with mode `0600`. The backup timer is enabled and active. |
| Production source, health and logs | Pass | The clean canonical checkout contains runtime commit `4473fc608f65e487e45601eb2c3eddb06c9010f5` plus this handover-only evidence update. API, Web, PostgreSQL, and Caddy are running/healthy; `/healthz`, `/readyz`, and `/login` passed through public HTTPS. Authenticated read-only smoke returned the owner identity, source-backed owner report metadata, reporting readiness, and bounded two-row customer/lot pages, then revoked the session. Post-release critical log scan was clean. |

## Acceptance suites completed before release

- Fresh database migration and idempotent production seed verification.
- Full API and Web production builds, lint, dependency audit, and package-tree check.
- Shortened session inactivity API lifecycle and Safari warning/keep-alive/expiry/multi-tab checks.
- Production-mode auth policy, auth hardening, RBAC/users, production hardening, reporting suite, report contract/PDF, labels/tiles, client workflow, direct-order lifecycle, inventory-location scope, document vault including range requests, and 600-row import scale.
- Authenticated live read-only public-HTTPS smoke plus post-release source, health, headers, migration, asset, container, and log verification.

## Truthful external limitations and owner actions

- General ledger/statements and supplier payables remain governed **Needs setup** areas. A real accounting/subledger source is required; they are not inferred from operational bookings.
- Historical quote/invoice margin coverage remains explicit. New transactions capture governed cost snapshots; today's product cost is never backfilled as historical fact.
- Password-reset token security is complete, but end-user delivery still requires an approved mail provider.
- Provider firewall/security-group configuration could not be independently proven from the host. The infrastructure owner must confirm public `80/443` and administrator-IP-only `22`; host UFW is inactive.
- Backups are verified on-host. Off-host replication, centralized error/trace alerting, and high availability remain infrastructure-owner setup items.
- This is a single-host deployment. Capacity is healthy for the current workload, but failover is not automatic; monthly query, storage, memory, and restore reviews remain required.

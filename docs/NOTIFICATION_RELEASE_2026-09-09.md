# Notification workspace release — 9 September 2026

## Release target

- Application: Marble Park, https://65-1-24-110.sslip.io
- Host: 65.1.24.110 only; checkout `/opt/marble-park`.
- Previous running release: `117224b0f46a65508c1b1c1cf72eacd2c5243e70`.
- Application release: `a43753c545faff83f430e4a394a8f27912d6524e`, branch `notification-workspace`.
- Commits: `d800e3c` work inbox and source fixes; `dd2c452` help and dependency patches; `a43753c` commercial PDF outcomes.
- Full operating guide and routing matrix: [Work inbox guide](NOTIFICATION_WORKSPACE_2026-09-09.md).

The original local workspace had broken Git metadata and an older code baseline. The release was built on the current production commit in a clean clone, preserving the latest quote/vault fixes. A durable clean checkout is retained at `/Users/devarshthakkar/.codex/worktrees/9ed7/Marble Park final/notification-release`. Unrelated original-workspace changes, including the storage-retention draft, were not deployed.

## What users receive

The bell now opens a permission-aware Work inbox, with My work, Team queue, Updates, Completed, Snoozed and Archived views. Users can search, page, claim/release team work, snooze, and bulk-manage personal read/history state. Claims are audited; no inbox action grants approval or posting authority. Links open the source record, where the real action is completed. A minute-by-minute source check resolves finished work and restores reopened tasks.

Fourteen action rules cover selections/quotes, customer follow-ups, collections, overdue invoices, overdue purchase orders, missing supplier rates/costs, stock approvals, dispatch, document failures and replenishment. Recorded blocked imports reach their uploader. Source data and current permissions determine the recipients; there is no implicit broadcast.

The existing interface-design patterns influenced this release: source-first actions, visible ownership, explicit waiting/error/empty states, mobile layout and existing design tokens rather than an unrelated visual theme.

## Validation completed before rollout

- API build and production web build, including type checks and all 58 routes: passed.
- Fresh disposable PostgreSQL database: all 47 migrations applied; 30 notification integration checks passed.
- Legacy notification migration fixture: original events retained, personal read-state isolation and duplicate-update archival verified.
- Concurrency, source/recipient changes, permission revocation, atomic bulk actions, failed-delivery replay, failed-source preservation and PDF failure/recovery: passed.
- Additional six PDF-route checks using mocked renderer/transport: success/failure recording, pricing/auth noise suppression, public-share isolation and telemetry-failure isolation passed. These are not physical PDF-renderer or production-request tests.
- Authenticated local owner browser: team claim → My work; exact intent destination; bell/full inbox; 390px mobile; simulated API failure and subsequent refresh recovery without forced logout.
- Pricing matrix, quote product/brand identity and session-client-resilience regression smoke checks: passed.
- Full npm audit, including development dependencies: zero known vulnerabilities at test time.
- Twenty concurrent inbox requests: 20 ms aggregate in the final local fixture test. This is not an AWS capacity benchmark or a guarantee for every business page.

## Backup and rollback preparation

- Backup: `/srv/marble-park/backups/notifications-pre-d800e3c-20260909.dump` (1.1 MB, mode 600).
- SHA-256: `64ecb3b324778cab7c0b3cd65b6c7568f484e3586b6fa9fc2dea5912426be6df`.
- PostgreSQL archive directory was readable with `pg_restore --list`; an actual restore was not performed on production.
- Previous images retained as `marble-park-api:rollback-117224b` and `marble-park-web:rollback-117224b`.
- Schema change is additive. Roll back application images before considering any database restore; do not restore over new customer transactions without a separate recovery decision.

## Live verification

**Live:** API and web containers were switched to the application release above on 9 September 2026 at approximately 13:20 IST. Both passed Docker health checks. Public API readiness and web health returned successful responses; login and inbox-route HTML returned HTTP 200. A public unauthenticated `notificationInbox` query correctly returned `UNAUTHENTICATED` with no data. Route HTML availability is not signed-in UI acceptance.

- Migration `20260909100000_notification_workspace` applied successfully at 07:50:28 UTC (13:20:28 IST).
- Worker heartbeat advanced from 07:50:32 to 07:51:31 UTC across independent automatic cycles.
- Pending deliveries: **0**. Failed deliveries: **0**. Work without a currently eligible recipient: **0**. Service health: **healthy**.
- Read-only inbox evaluation succeeded for all **17 active users**, using their current roles and effective permissions. No account/session was created or changed for this check.
- **474 real open tasks** were projected: 257 missing non-PO lot costs, 183 low/critical stock conditions, 16 missing PO-rate tasks, 6 customer follow-ups, 4 dispatch jobs, 4 overdue POs, 3 selections awaiting/in quote and 1 quote-pricing/approval task. These reflect existing backlog; no synthetic business records were introduced. Closed/absent conditions correctly produced no open task.
- Twenty concurrent read-only inbox service calls over the real database: **263 ms aggregate, 247 ms p50, 261 ms p95, 262 ms maximum**. This bounded diagnostic excludes network/browser overhead and is not a sustained-load/SLA guarantee.
- No API/web startup or notification-worker errors were observed in the rollout log check. Intentionally rejected unauthenticated checks are not delivery failures.
- Root storage after release: **18 GB free**, 77% used. No backup, business file or unrelated container was deleted.
- API running image: `sha256:a1ecb3fb5c9085aae24dc007e6479f23eeb826e57550d2555a12a8157e5d0d6b`.
- Web running image: `sha256:04292d267f748248a842b09ae0a8e054dce91effadae188fa10e0a75194c305a`.

All sampled business-table counts matched before and after rollout:

| Records | Before | After |
| --- | ---: | ---: |
| Products | 1,109 | 1,109 |
| Quotes | 23 | 23 |
| Sales orders | 10 | 10 |
| Purchase orders | 22 | 22 |
| Goods receipt notes | 109 | 109 |
| Inventory lots | 467 | 467 |
| Customers | 11 | 11 |

These count checks are a rollout guard, not a claim that every historic field was exhaustively compared. The deployment intentionally creates notification task/receipt records and migrates notification history; it does not create procurement, sales or stock transactions.

### First-use guidance

Refresh the application once, then open **Work inbox**. Salespeople should start with **My work**; procurement/stock and dispatch teams should use **Team queue** and claim the item they are handling. Owners should triage the supplier-cost backlog separately from stock-replenishment work using search. Open the source record and complete the actual task there; the inbox will reconcile it within the next minute. Use the in-app help guide for the full workflow.

## Explicit boundaries

This is an authenticated in-app notification release, not email, WhatsApp, SMS, OS push or independent infrastructure monitoring. No external notification provider is configured by this release.

Signed-in production browser acceptance by real owner/sales/procurement/dispatch users remains separate from local browser acceptance and live server diagnostics. No production test users, password resets or manufactured sessions were used.

Informational events emitted after a business transaction are still best-effort until persisted. The worker heals the listed source-driven action conditions; it cannot reconstruct every historical informational message lost during a database outage. Commercial PDF hooks cover quote and sales-order downloads; other PDF families and public-share downloads are not connected to this private outcome stream.

The full stack was not exhaustively re-certified and no literal 100% reliability claim is made. Existing pricing, stock and commercial authorization rules remain in force.

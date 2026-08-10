# Production-readiness evidence — 2026-08-10

Status: **release gate in progress**. This record is completed only after the canonical commit is deployed and authenticated production smoke passes.

## Required evidence

| Gate | Result | Evidence |
|---|---|---|
| Authentication regression root cause and credential preservation | Pending final release | Production seed must preserve an existing owner hash/profile; correct pre-regression credential state must be restored without exposing the hash. |
| Exactly 15-minute true inactivity | Pending final release | Test-only shortened lifecycle plus production 900-second configuration, server rejection, warning, meaningful interaction keep-alive, background-idle expiry, multi-tab sync, and safe logout redirect. |
| Session/cookie/CSRF/RBAC | Pending final release | Cookie attributes, no browser token storage, same-origin unsafe request enforcement, role matrix, disabled-user revocation, reset/change revocation. |
| Database migrations and seed idempotency | Pending final release | Fresh/clone migrate, existing credential invariant, session cap migration. |
| Dependency and source security | Pending final release | Production dependency audit, secret scan, GraphQL public surface, destructive script guard. |
| Commercial lifecycle and stock invariants | Pending final release | Approved isolated lifecycle suites; no production commercial mutation. |
| Reports, labels, tiles, pagination, help | Pending final release | API suites plus desktop/mobile route and print checks. |
| Backup and restore | Pending final release | Timestamped pre-release backup and successful temporary restore. |
| Production source/health/logs | Pending final release | Commit, containers, HTTPS health, authenticated read-only smoke, post-release logs. |

## Truthful external limitations

- General ledger/statements and supplier payables remain governed **Needs setup** areas.
- Password-reset delivery requires an approved mail provider; token lifecycle is not equivalent to delivery.
- Off-host backup, provider firewall review, centralized error/trace alerting, and high availability require infrastructure-owner setup/approval.
- Historical quote/invoice cost coverage remains explicit; today's master cost is never presented as historical fact.

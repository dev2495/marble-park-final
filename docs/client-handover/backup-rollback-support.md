# Backup, rollback, and support instructions

## Before every production release

1. Record the current production Git commit and container status.
2. Run `deploy/aws/backup.sh`. It captures a compressed PostgreSQL dump, uploaded assets, Caddy state, environment fingerprint, and manifest below the configured backup root.
3. Run `deploy/aws/restore-verify.sh <backup-directory>`. A backup is not accepted until it restores into a temporary database and the verification completes.
4. Run dependency, source, migration, build, session/RBAC, commercial lifecycle, inventory, report, label/tile, responsive browser, and no-data/edge-state gates against an isolated clone.
5. Deploy only the reviewed commit. `deploy/aws/deploy.sh` validates required secrets and the exact 15-minute production timeout, builds the images, waits for health, validates/reloads Caddy, then runs the idempotent create-only seed.

## Post-release acceptance

- Confirm `/healthz` and `/readyz` over HTTPS.
- Confirm the deployed Git commit and the running image creation time.
- Perform a safe authenticated read-only smoke: sign in, session status = 900 seconds, role-appropriate dashboard/reports, paged list, source drill, Help/PDF, and logout. Do not create or modify commercial records merely to test.
- Confirm production GraphQL introspection is unavailable, cross-origin unsafe requests are rejected, cookie flags are correct, and a server session cannot be used after expiry/logout.
- Review API/Web/Caddy/PostgreSQL logs for errors after smoke.
- Confirm the new backup timer run remains enabled.

## Rollback

Application rollback is commit-based: check out the recorded prior commit and rebuild through the same deployment script. Do not reverse a database migration casually. If a migration is incompatible, use a reviewed migration-specific recovery plan or restore the verified pre-release backup during an approved maintenance window.

For data recovery:

- stop business writes;
- capture a forensic backup of the current state;
- identify the exact verified backup and recovery point;
- restore into a temporary database first and reconcile row counts/invariants;
- obtain business-owner approval before replacing production data;
- retain the incident record and both pre/post recovery manifests.

## Support triage

Priority 0: login unavailable for valid users, data corruption, public data exposure, or core order/stock posting unavailable. Preserve logs and current state, avoid repeated deploys, and use the last verified rollback point.

Priority 1: incorrect commercial total/stock quantity, permission bypass, failed backup, or widespread workflow failure. Suspend only the affected workflow where possible and reconcile before correction.

For every ticket capture: timestamp with timezone, user role (not password), route, record/document number, visible error, request ID, browser/device, and whether another authorized user reproduces it. Never send `.env`, session cookies, password hashes, database backups, or private share tokens through ordinary support chat.

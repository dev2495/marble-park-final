# AWS storage cleanup and automatic backup retention

## Change

Production host: `65.1.24.110`, application checkout `/opt/marble-park`.
Operational release: `39f69cbb` on `notification-workspace`.

The root disk was **92% used (70 GiB used, 6.7 GiB available)**. Full local
backups occupied approximately 30 GiB: each daily backup repeated roughly
3.4 GiB of uploaded files, while each database dump was only about 1 MiB.
The old 14-day full-copy retention could exceed practical disk headroom.

The initial cleanup removed **21,358,568,475 bytes (21.36 GB / 19.89 GiB)** of
old full-backup files after checksum verification of the three retained full
sets and every database dump. Disk usage immediately fell to **66%**, leaving
about **27 GiB free**. Approximately 11 MiB of database history was preserved.

Removed full sets:

- `20260904T095030Z`
- `20260905T021630Z`
- `20260907T090607Z`
- `20260908T022717Z`
- `20260908T070842Z`
- `20260909T021911Z`

Those old full archives are permanently deleted. Their recent database dumps
remain in `backups/database-history`; older asset versions unique to a deleted
archive cannot be recovered from database-only history.

## Automatic policy now deployed

- Keep the **three newest verified full database + uploaded-file backup sets**.
- Keep **14 calendar days of database-only history**, verified before pruning.
- Run through the existing enabled nightly `marble-park-backup.timer`:
  02:15 UTC plus up to 15 minutes of jitter, or 07:45–08:00 IST.
- Serialize manual and scheduled backup/cleanup using the same exclusive lock.
- Build in a private partial directory, validate the database dump, then publish
  the completed backup atomically. Normal failures remove their own partials.
- Prune only after successful backup creation and optional configured S3 upload.
- Refuse cleanup on checksum errors, incomplete/unexpected contents, symlinks,
  or a newest backup older than 48 hours. Never prune with fewer than three sets.
- Do not prune special pre-release files, current uploads, PostgreSQL files,
  containers, images, rollback tags, or unrelated server directories.

## Verification

- 13 regression tests passed locally and on AWS: dry-run, repeat/idempotence,
  minimum-three floor, corrupt retained assets, corrupt old dumps, incomplete
  sets, stale backups, symlink/path/manifest protection, history expiry and
  interruption recovery, and concurrent/inherited locks.
- Shell syntax and Git whitespace checks passed.
- Production dry-run verified actual backups and listed exact cleanup targets
  before apply. Source deployment did not rebuild or restart application services.
- API readiness and web health stayed successful during cleanup/backup activity.
- A retained backup passed both database/assets checksums, and its database
  restored successfully into a separate verification database with **91 public
  tables**. The verification database was then removed; production was untouched.
- The actual systemd backup service was run on demand. It completed successfully
  at **08:06:39 UTC on September 12**, exit status 0, publishing
  `20260912T080137Z` and automatically removing the superseded full set
  `20260910T022201Z` after preserving its database history. This confirmed the
  scheduled backup and retention path end to end, not just standalone cleanup.
- Final full sets: `20260912T080137Z`, `20260912T021956Z`,
  `20260911T022047Z`. Final disk usage remained **66% with about 27 GiB free**.
  The new full archive replaced an older one without increasing retained count.

## Remaining boundary

`BACKUP_S3_URI` is not configured. Local backups protect against some operational
mistakes but **not loss of this instance/disk**. Off-server backup storage and its
lifecycle require a separately approved destination and permissions.

The policy bounds full-copy count, not underlying data growth. At current size,
full backups use roughly 10 GiB, temporarily increasing by one archive during
the next run. Docker build cache and rollback images were inspected but left
untouched. Continue monitoring total disk usage as live uploads/builds grow.

For manual commands and failure investigation, see `deploy/aws/README.md`.

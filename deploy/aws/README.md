# AWS Production Runbook

This package runs Marble Park on one EC2 host while keeping the deployment
replaceable. PostgreSQL, uploaded product images, delivery proofs, Caddy state,
and backups live below `/srv/marble-park` on the encrypted EBS volume.

## Recommended initial host

- Region: `ap-south-1` (Mumbai)
- Instance: `t3.medium`, 2 vCPU and 4 GiB RAM
- OS: Ubuntu Server 24.04 LTS, x86_64
- Storage: 60 GiB encrypted `gp3`, delete-on-termination disabled
- Elastic IP: one static IPv4 address
- Security group: `80/tcp` and `443/tcp` public; `22/tcp` restricted to the
  administrator's current public IP
- No RDS, load balancer, EFS, or other paid application service in the initial
  deployment

The temporary hostname is `<elastic-ip-with-dashes>.sslip.io`. Caddy obtains and
renews a public TLS certificate for it. Replace `APP_HOST` with the client-owned
domain later; no application code change is required.

## First deployment

1. Run `bootstrap-host.sh` as the `ubuntu` user, then reconnect once so Docker
   group membership applies. This installs Docker Engine, Compose, Git, AWS CLI,
   unattended security updates, and a 4 GiB swap file for controlled image builds.
2. Clone this repository to `/opt/marble-park` and check out the approved commit.
3. Allocate and associate the Elastic IP before building the web image.
4. Copy `.env.example` to `.env`. Generate `POSTGRES_PASSWORD`, `JWT_SECRET`, and
   `BOOTSTRAP_OWNER_PASSWORD` with a cryptographically secure generator. Do not
   commit `.env`.
5. Prepare persistent directories and lock down access:

   ```bash
   sudo install -d -m 0700 /srv/marble-park/{postgres,assets,backups,caddy/data,caddy/config}
   sudo chown -R "$USER":"$USER" /srv/marble-park
   chmod 600 deploy/aws/.env
   ```

6. Build and start the stack:

   ```bash
   cd /opt/marble-park/deploy/aws
   ./deploy.sh
   ```

   Production seeding is idempotent and creates the configured owner only when
   that account is absent. It never overwrites an existing owner's password,
   role, profile, or permissions. Never set `SEED_MODE=demo` on this stack.

7. Install the backup timer:

   ```bash
   sudo cp marble-park-backup.service marble-park-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now marble-park-backup.timer
   ```

## Release checks

```bash
docker compose --env-file .env ps
curl --fail --silent "https://${APP_HOST}/healthz"
curl --fail --silent "https://${APP_HOST}/readyz"
curl --fail --silent "https://${APP_HOST}/api/health"
./backup.sh
sudo ./restore-verify.sh /srv/marble-park/backups/<timestamp-printed-by-backup.sh>
```

Then run the repository smoke suites with `API_URL=https://${APP_HOST}/graphql`
and `WEB_URL=https://${APP_HOST}`. Verify desktop, tablet, and mobile routes in a
real browser before handing over the owner credentials.

Local backups are included in the initial server-only deployment. An S3 target
can be added later by setting `BACKUP_S3_URI` and attaching a narrowly scoped IAM
instance profile, but that is intentionally not created without client approval.

### Bounded local backup retention

The existing nightly timer runs at 02:15 UTC plus up to 15 minutes of jitter
(07:45–08:00 IST). After a successful backup and optional S3 upload, `backup.sh`
automatically retains the **three newest checksum-verified full backups** and
**14 calendar days of database-only snapshots** in `backups/database-history`.
Older database snapshots do not include historical uploaded-file archives;
recovering older deleted uploads requires an off-server full backup.

Backups publish atomically after dump validation and archive creation. One lock
prevents overlapping backup/retention runs. Cleanup refuses stale backups (over
48 hours), corrupt retained archives, corrupt database dumps, symlinks, unexpected
files, or incomplete timestamped sets. It never removes special pre-release
files, live assets, PostgreSQL storage, containers, or images. Fewer than three
complete sets results in no cleanup. Unexpected `.partial-*` or `.pruning-*`
directories require operator inspection; normal failed runs remove their own
partial output. Failures are visible in the systemd unit/journal.

Preview and apply retention manually (no application restart):

```bash
sudo python3 /opt/marble-park/deploy/aws/backup-retention.py --root /srv/marble-park/backups
sudo python3 /opt/marble-park/deploy/aws/backup-retention.py --root /srv/marble-park/backups --apply
systemctl status marble-park-backup.timer marble-park-backup.service
journalctl -u marble-park-backup.service -n 50 --no-pager
df -h /
```

This bounds the number of full copies, not their individual size. At 3.4 GB of
assets, steady-state backups occupy roughly 10 GB, with another 3.4 GB needed
while creating the next backup. Growing uploads and Docker builds still require
disk monitoring. Local retention does **not** configure S3 retention/lifecycle or
protect against instance loss. Avoid broad `docker system prune` and never prune
database WAL or uploaded files to recover disk space.

## Upgrade and rollback

Before each upgrade, run `backup.sh`, record the current Git commit, and verify
the backup. Build the candidate images, then run `docker compose up -d`. Database
migrations execute before the API starts accepting traffic. If application code
must be rolled back, check out the recorded commit and rebuild; do not reverse a
database migration without a reviewed migration-specific recovery plan.

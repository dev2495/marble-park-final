# Marble Park performance improvement backlog

Status: planning source only. No performance item in this document was implemented as part of the PO-rate change.

Baseline captured during the 25 August 2026 review. Re-measure before and after every change; do not treat this snapshot as a permanent capacity guarantee.

## Current evidence and verdict

| Signal | Reviewed baseline |
|---|---:|
| Application host | 2 vCPU, about 3.8 GB RAM, single host |
| Database size | about 32 MB |
| Products / lots / audit events | 1,047 / 372 / 2,403 |
| Representative product / quote / audit query | 0.124 ms / 0.111 ms / 0.093 ms |
| Representative stock-ledger query | 1.878 ms |
| Representative aggregation | 3.03 ms |
| Public health load, concurrency 20 | 300 requests, 0 failures, p95 265 ms |
| Login-page load | 120 requests, 0 failures, p95 434 ms |
| Browser check | desktop load 581 ms, FCP 552 ms; warm mobile load 102 ms, FCP 120 ms; no observed console error or horizontal overflow |
| Local catalogue assets | about 3 GB / 1,073 files |
| Local backups | about 34 GB |
| Host disk | about 88% used, about 10 GB free |

Verdict: 15–20 users doing normal daily work is plausible at the reviewed data volume. It is **not yet certified** for 15–20 concurrent authenticated users performing a mixed workload of scanning, quote editing, PO/GRN posting, report generation, PDF export, and uploads. Disk headroom is the most immediate operational risk.

## Prioritized implementation backlog

| Priority | Improvement | Why it matters | Implementation boundary | Acceptance evidence | Flow/logic impact |
|---|---|---|---|---|---|
| P0 | Restore disk headroom | 88% utilization leaves little room for logs, images, backups, Docker layers, or a database spike | Inventory aged local backups/assets/container layers; verify an off-host copy and restore first; then use governed retention and alerts | More than 30% free space; latest backup restored in an isolated environment; no active asset missing | None |
| P0 | Prove off-host backup and recovery | A same-host backup does not protect against host or disk loss | Encrypted scheduled off-host database + asset backup, checksums, retention, documented restore drill | Successful timed restore with row/file counts and application smoke test | None |
| P0 | Resolve leftover acceptance containers | Unknown containers can consume disk/RAM or create false service health | Identify owner, purpose, ports, volumes, age, and last use; stop/remove only after ownership confirmation | Container inventory signed off; production and current acceptance services unaffected | None |
| P0 | Add infrastructure alerts | Capacity problems should be seen before users report slowness | Alerts for disk, memory, container restarts, database reachability/connections, backup age/failure, API errors | Test alerts reach the responsible owner with runbook links | None |
| P1 | Replace owner-dashboard full reads with database aggregations | Loading full Product/Quote rows and aggregating in JavaScript grows linearly and wastes API memory | SQL `GROUP BY`, top-N queries, bounded date ranges, purpose-built read models | Same KPI values; p95 and rows transferred materially lower at 10x fixture volume | None |
| P1 | Move report computation into SQL/read models | 366-day full-row fetch, in-memory filtering, sorting, and trend calculation will become report latency and memory hotspots | Indexed SQL views/materialized views or cached aggregates with freshness labels and drill-through | Report totals reconcile; p95 under 2 s; bounded API payload; cache invalidation proven | None |
| P1 | Use keyset/cursor pagination for deep registers | Offset pagination becomes slower and less stable on changing large tables | Cursor on stable `(createdAt,id)` or business sort key for Quote, Product, Customer, Lead, Document, and Stock Ledger lists | No duplicates/gaps during concurrent inserts; deep-page query plan stays index-backed | None |
| P1 | Make reconciliation an asynchronous exception-first snapshot | A synchronous `take: 5000` check cannot represent an unbounded catalogue safely | Background reconciliation job, persisted snapshot, progress/freshness, cursor-paged exceptions, safe rerun | 100% source coverage stated; refresh does not block request thread; exception rows drill through | None |
| P1 | Server-page remaining large client-filtered screens | Stock Count, Returns, Receivables, and similar bounded lists will feel slow as data grows | Server search/filter/sort, page/cursor contracts, debounced requests, explicit totals | Constant DOM size; search p95 under 500 ms; filters reconcile to source counts | None |
| P1 | Add search indexes from measured slow queries | Broad `contains` search can degrade into scans | Enable/verify `pg_trgm`; add targeted indexes for measured hot fields such as audit summary/action/entity, lead title/notes, supplier document references, contacts, and locations | `EXPLAIN ANALYZE` uses intended index; write overhead measured; no speculative duplicate indexes | None |
| P1 | Govern database pooling | PostgreSQL max connections was about 100; unbounded application pools can exhaust it before CPU is busy | Explicit Prisma connection limit and pool timeout; size from app instances/workers; add PgBouncer/RDS Proxy before replicas | Sustained mixed test uses under 60% of DB connections; timeout errors zero | None |
| P1 | Queue heavy PDF, spreadsheet, and image jobs | CPU/memory-heavy synchronous rendering competes with scans and commercial writes | Bounded worker queue, job status, idempotency, retry/dead-letter policy, per-user concurrency limits | Interactive p95 remains within SLO during export burst; duplicate jobs do not duplicate documents | None |
| P1 | Add end-to-end observability | Averages and HTTP 200s hide slow queries, browser stalls, and partial failures | API p50/p95/p99, route/error rate, slow-query logging, Web Vitals, queue depth/duration, correlation IDs | Dashboard and alerts show one test incident from browser through API/DB/worker | None |
| P1 | Set container resource/concurrency limits | One runaway renderer/import can starve the API on a 2-vCPU host | CPU/memory limits, health checks, restart policy, worker concurrency, graceful shutdown | Load test cannot make API unhealthy through an export/upload burst | None |
| P1 | Remove base64/large-body memory amplification | A 25 MB upload encoded or copied in memory can use several times its file size | Direct multipart/object-storage upload, streaming validation, strict MIME/size limits | Peak API memory remains bounded during concurrent maximum-size uploads | None |
| P2 | Move media to object storage/CDN | Local 3 GB asset growth couples deploys, disk, backups, and image delivery | Object storage, immutable keys, CDN, responsive variants/srcset, migration manifest and rollback | All sampled product/label/quote images render; originals recoverable; host disk reduced | None |
| P2 | Add high availability when justified by SLO | A single host is a single failure domain | Second stateless app instance, load balancer, managed database/replica as required, external session/object storage | Instance loss test preserves availability and document integrity | None |
| P2 | Run authenticated 15–20 user mixed-workload certification | Public health/login tests do not exercise authorization, database writes, locks, PDFs, or real browser flows | Isolated staging clone with synthetic data; scripted scans, search, quote save, PO/GRN, reports, PDF, labels; safe cleanup and invariant checks | SLOs below pass with zero stock/commercial invariant failures and documented bottlenecks | None |
| P2 | Establish monthly capacity review | Performance changes with data, users, assets, and releases | Trend database/assets/audit/ledger growth, p95/p99, slow queries, disk, connections, queue backlog; define scale triggers | Monthly record with owner, thresholds, decisions, and follow-up items | None |

## Proposed service-level objectives

- QR/label scan resolution p95 under 400 ms.
- Search and page navigation p95 under 500 ms and p99 under 1 second.
- Interactive writes p95 under 1 second, excluding explicitly queued jobs.
- Normal reports p95 under 2 seconds with freshness/coverage visible.
- Server error rate below 0.5% during the certified mixed workload.
- Database CPU below 60% sustained and connection use below 60% of the configured maximum.
- Host disk stays above 30% free; backups remain within the agreed recovery point objective.
- No duplicate commercial document, stock movement, GRN, or audit event under retries/concurrency.

## Recommended execution order

1. Disk, backup/restore, container ownership, and alerting.
2. Observability and a repeatable authenticated mixed-workload test.
3. Dashboard/report query reductions and server pagination.
4. Database pooling/index tuning driven by captured slow queries.
5. Worker queue, upload/media decoupling, and resource limits.
6. Re-run certification, then decide whether a second application instance or managed database change is justified.

Every optimization must preserve current permissions, document numbering, idempotency, audit records, exact-lot lineage, price snapshots, and stock invariants. A faster result that changes commercial or inventory truth is a failed optimization.

# Marble Park ERP Live Handover - Source Notes

## Reporting job

- Question: Is the redesigned Marble Park sanitaryware, tiles, bathroomware and showroom ERP live, complete enough for controlled client onboarding, and what remains before staff rollout?
- Audience: Client owner and product stakeholders.
- Scope: New isolated AWS Lightsail production environment, deployed repository release, clean PostgreSQL production database, authenticated API checks, responsive browser checks, backup and restore verification through July 17, 2026.
- Decision: Begin controlled onboarding after domain, off-host backup policy, role-based users, master/opening-stock import and client UAT are signed off.

## Executive structure mapping

1. Title: `Marble Park ERP: Live Production Handover`
2. Executive Summary: live decision, implemented scope, tile answer and remaining procedural gates.
3. Key findings: environment, verification matrix, implemented lifecycle, tile model, stock lifecycle and access/recovery controls.
4. Recommended next steps: controlled go-live action table.
5. Further questions: domain, backup, users, source files and operating policy.
6. Caveats and assumptions: temporary hostname, cost exclusions, device coverage and disaster-recovery boundary.

## Release evidence

- Production URL: `https://65-1-24-110.sslip.io`
- AWS account: isolated Marble Park account; Mumbai region.
- Host: Lightsail, 2 vCPU, 4 GB RAM, 80 GB SSD, static IP, Ubuntu 24.04.
- Monthly instance bundle: USD 24 before tax and optional services.
- Public firewall: 80/TCP, 443/TCP; SSH 22/TCP retained for administration.
- Containers: PostgreSQL 16, NestJS API, Next.js web, Caddy 2.10.
- Host state at handover: 17% disk used, 2.8 GB memory available, 4 GB swap.
- Public checks: `/healthz`, `/readyz`, `/api/health` and `/` passed over HTTPS.
- TLS: HTTP/2 200, HSTS, frame-deny and permissions policy observed.
- Authenticated routes reviewed: command center, leads, new quote, Product Master, inventory, procurement, dispatch, users.
- Browser widths: 1280x desktop, 820x tablet, 390x mobile. No body overflow or browser console errors observed.
- Database account audit: one active user, one owner, Devarsh, `dvrshthakkar@gmail.com`; no demo records inserted.
- Application readiness: score 96, `production_ready_phase_2`.
- Backup: manual database/assets backup checksums passed; test restore exposed 71 public tables.
- Daily local backup timer installed and enabled.

## Repository evidence

- `46aa18c` - universal retail stock lifecycle implementation.
- `8e342cb` - reproducible AWS production deployment.
- `e9c7728` - Ubuntu Lightsail and edge-network hardening.
- Release gates completed earlier in the implementation run: six lifecycle smoke scripts, clean database migrations, API/web builds, backup/restore and responsive local browser QA.

## Chart contract and map

- Section: Every defined production handover control passed.
- Analytical question: How many independently defined controls passed in each release area?
- Takeaway: 24 of 24 controls passed; authenticated route checks form the largest evidence group.
- Family/type: categorical comparison, horizontal bar.
- Data sufficiency: six meaningful release areas, each with exact passed and defined counts.
- Encodings: release area on the categorical axis, passed checks on the quantitative axis; total and coverage retained in tooltips.
- Palette: single-root blue with direct values and neutral scaffolding; no redundant series legend.
- Caveat: counts represent different checklists and are evidence coverage, not relative business importance.
- Final surface: canonical portable HTML report and Chrome-generated PDF.

## Security boundary

- Passwords, JWT secrets, database credentials, private keys and session tokens are intentionally excluded from the report artifact.
- The owner bootstrap password is transferred separately and should be rotated after first sign-in.
- Current backup is on-host. Off-host encrypted retention and periodic restore drills remain a client policy action.

## Sources and reproducibility

- Production verification used read-only GraphQL, HTTPS, Docker status, host capacity, timer, checksum and restore checks.
- The report's `production-audit` source preserves a bounded SQL `VALUES` query for headline metrics.
- The report's `report-table-evidence` source preserves reviewed table evidence without including secrets or local machine paths.

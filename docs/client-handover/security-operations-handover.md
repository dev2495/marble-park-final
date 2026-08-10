# Security and operations handover

## Authentication and access control

- Authentication uses an opaque 256-bit random session token in the `mp_session` cookie. The cookie is `HttpOnly`, `Secure` in production, `SameSite=Lax`, path `/`, and has the same 15-minute idle lifetime as the server record. The application does not persist auth tokens in local or session storage.
- Production idle timeout is fixed to exactly 15 minutes. A shorter override is accepted only under `NODE_ENV=test`. The server rejects expired sessions on every protected request; the browser warning and redirect are usability layers, not the security boundary.
- Keep-alive is sent only after trusted user input and is rate-limited in the browser. Background polling does not extend a session. Logout/expiry synchronizes across tabs.
- Login failures are recorded and account-plus-source throttling starts after repeated failures. Error text does not reveal whether an account exists.
- Password reset tokens are cryptographically random, single-use, one-hour records. Successful reset changes `passwordChangedAt`, revokes all sessions, and writes an audit event. Production needs an approved delivery provider before self-service reset can be offered as complete.
- GraphQL IDE and schema introspection are disabled in production. Unsafe cookie-authenticated requests require a same-origin `Origin`/Fetch-Metadata signal; automation using bearer sessions is not treated as a browser cookie request.
- Role permissions are enforced in resolvers/services, not only hidden in navigation. Disabled/deleted users lose active sessions immediately.

## Secret handling

- `deploy/aws/.env` is host-only mode `0600`; it is never committed or copied into support tickets.
- Production deploy requires PostgreSQL password length at least 24, JWT secret length at least 48, owner bootstrap secret length at least 16, HTTPS hostname syntax, and exactly `SESSION_IDLE_TIMEOUT_MINUTES=15`.
- The production seed creates the bootstrap owner only if absent. It must never update an existing password, profile, role, or permission set.
- Rotate a suspected secret, revoke related sessions/links, record the incident, and verify logs. Rotating the bootstrap environment secret alone does not and must not change an existing owner's login.

## Public edge and host

- Public application traffic terminates at Caddy on HTTPS. PostgreSQL and the API/Web container ports are internal-only. Security headers include HSTS, MIME sniffing protection, frame restriction, referrer policy, and permissions policy; the upstream framework signature is removed.
- The cloud security group must allow public `80/443` and restrict `22` to approved administrator IPs. This provider-side rule is an infrastructure-owner acceptance item; an inactive host firewall does not prove the cloud rule is correct.
- `/healthz` confirms edge availability, `/api/health` confirms API liveness, and `/readyz` confirms application and database readiness.

## Audit and reversal safeguards

- Commercial documents are canceled/voided/reversed with reasons; they are not hard-deleted to rewrite history.
- Role, permission, password, user-state, target, label, stock, import, document-share, and commercial lifecycle actions write audit events. High-impact business writes that require legal-grade non-repudiation should be reviewed for transactional audit coupling; the generic audit helper intentionally does not block a business write if the audit sink fails.
- Public document/vault links must be time-limited (new links max 90 days), revocable, and permission-scoped. Legacy non-expiring links remain visible for owner review rather than being silently deleted.
- The destructive client-test reset script refuses production and requires an explicit non-production confirmation plus a 12-character test password.

## Availability, scaling, and observation

- Current topology is a single EC2 host with Docker Compose, PostgreSQL, persistent EBS storage, Caddy, Web, and API. It is suitable for the present workload but is not high availability; host or volume loss can cause downtime.
- High-volume owner surfaces use server pagination or bounded operational queries. Search/indexing should be measured against production growth; review slow database queries and container resource use monthly.
- Primary observation is container/Caddy logs, health endpoints, disk/memory checks, backup timer state, audit events, and request IDs. Centralized error/trace alerting is an external setup item.

## Monthly security checklist

1. Review active users, roles, permission overrides, deleted/disabled accounts, and legacy document links.
2. Review failed/throttled logins, sensitive audit actions, failed document jobs, and stock/financial reversals.
3. Run dependency audit in the approved source checkout and apply reviewed updates.
4. Confirm TLS renewal, host security updates, disk free space, backup timer success, off-host copy, and restore drill status.
5. Confirm provider firewall rules and remove stale administrator SSH access.

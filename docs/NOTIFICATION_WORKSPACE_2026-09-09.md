# Marble Park work inbox

## Using the inbox

Open **Work inbox** in the sidebar, or the bell → **Open full inbox**. The page's help icon opens the matching four-minute in-app guide.

1. **My work** shows personal assignments and team tasks you have claimed.
2. **Team queue** shows unclaimed work your current permissions allow you to handle. Claim a task to make responsibility clear. Claiming does not grant new permissions or bypass the source page's approvals/locks.
3. Use the action button to open the relevant selection, quote, customer, purchase order, stock request or dispatch register.
4. Complete the business action on its source page. The inbox checks committed source records every minute and moves finished work to **Completed**. Reading a notice never approves, posts, pays or completes anything.
5. Use **Snooze 1 hour** for a personal reminder break. Open work cannot be archived. **Updates**, **Completed** and **Archived** support bulk read/unread and archive/restore.
6. Search by the identifiers and names included in the notice. Pagination is server-side, 30 entries per page. Unread state belongs to each user, not their entire role.
7. **Mute update badge** removes routine updates from the bell/badge without hiding required work. Updates remain in their own tab.

Customer follow-ups now have an outcome form on the lead page. Only the assigned salesperson, owner, admin or sales manager may complete one. A written outcome is required; the activity and audit record commit together.

## Routing and completion

| Work | Recipient | Clears when |
| --- | --- | --- |
| Selection waiting / being quoted | Current intent lock holder, otherwise quote-management team | Intent leaves pending/in-quote state |
| Missing quote pricing | Quote owner, owner/admin fallback if inactive | Pricing becomes complete |
| Below-floor quote approval | Owner/admin | Approval no longer pending or quote becomes terminal |
| Due customer follow-up | Assigned salesperson, owner/admin fallback | Follow-up completed, or lead lost/cancelled |
| Collection task | Assigned user, payment-management fallback | Collection task completed |
| Overdue invoice | Payment-management team | Paid, voided, cancelled, draft, or no longer overdue |
| Overdue PO delivery | Procurement-management team | Delivery/status/date no longer qualifies |
| PO supplier rates missing | Owner/admin | Relevant rates completed or PO cancelled |
| Manual/opening/other lot cost missing | Owner/admin | Actual cost completed or lot inactive |
| Submitted physical count | Owner/admin | Request no longer submitted |
| Submitted opening stock | Owner/admin | Request no longer submitted |
| Pending stock adjustment | Owner/admin | Request no longer pending |
| Open dispatch job | Dispatch-management team | Delivered, completed or cancelled |
| Failed document generation | Requesting user, owner/admin fallback | Source document job no longer failed |
| Low/critical stocked SKU | Procurement-management team | Stock recovers, threshold disabled or product inactive |

Cost reminders do not block inward. Manual/opening lot reminders show a 20-day follow-up date; this is not a new purchase-cost validation rule. PO-linked lots use the PO cost task rather than a duplicate lot task. Never-stocked, unreserved catalogue products do not create replenishment tasks simply because a default threshold exists.

Recorded import failures/blocked Excel imports from the last 30 days appear as updates to the uploader. Existing quote, order, inward and dispatch event notices remain available; direct orders now notify their salesperson for dispatch/delivery too. Quote messages distinguish missing pricing, pending approval and readiness.

## Reliability and access

- Additive schema: original Notification events remain. New per-user receipts hold read/archive/snooze state. Shared legacy read flags are not falsely attributed to every user.
- Historical duplicate updates are archived per recipient, not deleted. Old threshold messages are archived in favor of current-source stock tasks.
- Stable source task keys prevent duplicate action tasks. Reopening or severity changes restore unread state. Ineligible claims are released.
- Recipient access is checked again on every read and mutation. Bulk changes are all-or-nothing. Concurrent team claims have one winner and an audit record.
- A database advisory lock serializes source projection across API replicas. Source reads are paged in batches of 200. Failed scans roll back and do not falsely resolve existing tasks.
- Persisted events use unique receipts, delivery attempt counters and exponential retry (one minute up to one hour). Delivery continues independently of source-scan failures.
- Owner/admin **Delivery service** shows the last source check, pending/retrying deliveries and work without recipients. A stale heartbeat or unrouted work is not reported as healthy.
- Visible pages refresh every minute and on focus; hidden-tab polling is skipped. Bell opening refreshes data. Navigation does not wait on a read-receipt request.

## Related fixes and boundaries

- Quote header and normalized quote lines now update in one transaction with their audit event.
- Actual lot-cost completion updates costStatus consistently.
- Audit report event count is uncapped; detail/breakdown sampling at 5,000 events is explicitly labelled. Notification metric now counts personal unread deliveries, not obsolete role-wide readAt flags.
- General post-commit audit failures are logged as AUDIT_WRITE_FAILED rather than silently swallowed. This is not a claim that every historical business writer is now transactionally lossless: informational events emitted after a business commit can still fail before persistence during a database outage. Source reconciliation repairs the listed action conditions, not arbitrary missing historical events.
- This release is an authenticated **in-app** notification system. It does not configure WhatsApp, email, SMS or operating-system push, and is not a replacement for infrastructure/storage monitoring.
- Core stock, tax, pricing, approval and period-close rules are not bypassed. Work assignment is coordination, not an authorization grant.

## Verification

- API build and production web build (58 routes): passed.
- Disposable PostgreSQL integration gate: 29 checks, including legacy migration, all 14 action rules, uploader-only import updates, permissions, follow-up completion, read isolation, claims, reopening, pagination, retry injection and failed-source preservation.
- 20 concurrent local fixture inbox requests: 33 ms aggregate; this is not an AWS load/capacity guarantee.
- Browser: authenticated local owner, team claim to My work, exact intent destination, 390px mobile layout, bell/full-inbox navigation and simulated GraphQL error without forced logout; source refresh recovered the inbox.
- Existing pricing matrix, quote product/brand identity and session-client-resilience smoke checks: passed.
- Full npm audit, including development tools: zero known vulnerabilities at review time. Framework/security dependency updates preserve the current stack.

Run integration tests only with a new disposable database whose name starts marble_notifications_test_. Apply migrations, build the API, then run `node scripts/notification-workspace-test.cjs`. Test accounts and test password are deliberately local-only fixtures and must never be seeded in production.

Deployment evidence is recorded separately after rollout. Authenticated client acceptance must not be inferred from a successful build or an HTTP health response.

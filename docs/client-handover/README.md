# Marble Park ERP client handover

This pack is the operational handover for the canonical AWS release. It is written for the owner, administrators, department leads, and the support engineer who will operate the system after go-live.

## Start here

- [Live user and admin quick-start](live-user-admin-quick-start.md)
- [Missing-data ownership and setup checklist](missing-data-ownership-setup-checklist.md)
- [Security and operations handover](security-operations-handover.md)
- [Backup, rollback, and support instructions](backup-rollback-support.md)
- [Production-readiness evidence](production-readiness-evidence-2026-08-10.md)

## System boundary

Marble Park is the source of truth for the operational records it captures: customers, leads, quotes, orders, inventory lots and movements, procurement, dispatch, returns, receivables, documents, labels, users, audit events, and governed report targets. It is not yet a general ledger or supplier-payables subledger. P&L, balance sheet, cash-flow statements, and supplier aging must remain **Needs setup** until an accounting source is connected or a dedicated governed module is approved.

Never fill a report gap with an estimated or manually relabelled value. Use the linked setup path, correct the originating transaction/master, or keep the report explicitly unavailable.

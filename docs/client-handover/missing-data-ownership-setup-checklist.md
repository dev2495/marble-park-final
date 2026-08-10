# Missing-data ownership and setup checklist

This checklist distinguishes data Marble Park already captures, data that needs a governed in-app setup, and data that needs an external source. A report must stay unavailable when its authoritative source is missing.

| Data area | Current status | Owner | Correct action |
|---|---|---|---|
| Monthly sales, booking, and collection targets | Governed entry exists | Owner / administrator | Use **Reports → Setup → Set company target**. Each revision creates a new version; voiding requires a reason. |
| Product category, brand, finish, material, tax, UOM, warehouse SKU, display code, aliases, tile size | Existing master workflows | Product/master-data owner | Correct **Products**, **Tiles Master**, and **Tile Size Master**. Never patch a report row. |
| Customer, architect, salesperson/operator attribution | Existing transaction/master fields, with explicit exception reporting | Sales manager | Correct the customer/architect master or originating lead/quote/order. Do not infer a missing architect from free text. |
| Credit limits and terms | Existing customer credit profile | Owner / authorized finance operator | Maintain the customer credit profile. Exposure uses open receivables plus governed unbilled exposure. |
| Quote historical cost | Automatic for new quote lines | Product master + sales operations | Maintain valid product cost before quoting. Historical lines without a saved snapshot remain uncovered; no backfill from today's cost. |
| Invoice/realised cost | Automatic for new invoice lines when dispatched lot cost is available | Inventory + finance operations | Complete lot-cost, allocation, dispatch, and invoice lineage. Historical uncovered invoice lines stay marked uncovered. |
| Stock at cost and aging | Existing lot/ledger workflow | Inventory manager | Receive or open stock with approved unit cost and maintain lot movement chronology. Correct through stock workflows, not reports. |
| Preferred vendor, lead time, MOQ, pack multiple, reorder point | Existing Product Vendor / Reorder Policy workflow | Purchasing / inventory manager | Maintain vendor and reorder policy masters. Reorder reports should retain an exception until required inputs exist. |
| Supplier invoices, supplier payments, payment allocation, supplier aging | No AP subledger | Finance owner | Select an accounting integration or approve a dedicated AP module with supplier invoice, credit, payment, allocation, reversal, due-date, and opening-balance controls. Purchase orders/GRNs are not AP. |
| P&L, balance sheet, cash flow, expenses, bank reconciliation | No general ledger | Finance owner + accountant | Integrate an authoritative accounting system or approve a governed chart of accounts, journals, periods, opening balances, expense, tax, and bank-reconciliation module. Do not derive statements from operational invoices alone. |
| Branch/channel/source attribution | Only trustworthy where the originating field exists | Business owner | Define a controlled branch/channel/source master and required capture point before enabling cross-branch/channel KPIs. |
| Budgets beyond the three governed company metrics | Not modeled | Owner + finance | Approve a target master extension defining metric, level, period, currency, version, approver, and actual-source mapping. |
| Password-reset delivery | Token lifecycle exists; delivery provider is not configured | Administrator / support | Configure an approved mail provider and domain, then verify one-time delivery, expiry, and audit without exposing the token. Until then, use the audited admin reset flow. |
| Off-host backups | Optional S3 target not yet confirmed | Infrastructure owner | Configure `BACKUP_S3_URI` with a narrowly scoped instance role, retention, encryption, and a restore drill. Local backups alone do not protect against host loss. |

## Readiness review cadence

- Owner/administrator: review Reports Setup and audit exceptions monthly.
- Sales manager: review attribution, stale pipeline, and conversion-source exceptions weekly.
- Inventory/purchasing: review lot-cost coverage, negative/held stock, vendor/reorder readiness, and overdue inward work daily.
- Finance: review invoice/collection allocation, AR aging, credits, and missing accounting integration status at month end.

When a source is added, acceptance requires: named owner, validation rules, immutable/reversal lineage where relevant, audit event, role restriction, migration behavior, empty/error state, and a reconciled report test.

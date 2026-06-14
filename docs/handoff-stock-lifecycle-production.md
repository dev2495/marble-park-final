# Marble Park Stock Lifecycle Production Handoff

## Objective

Close the remaining production gaps in stock lifecycle, reconciliation, dispatch safety, tile master, and release verification before handing the Railway app to the client with a clean database.

## Patch Checklist

- [ ] Route every stock mutation through one posting path that writes `InventoryBalance`, `StockBalanceByLocation`, `InventoryMovement`, and `StockLedgerEntry`.
- [ ] Sync `SalesOrderLine` after every reservation, release, backorder auto-allocation, dispatch, special-order allocation, and stock-count adjustment that impacts order readiness.
- [ ] Add a reconciliation API and UI page that compares product balances, location balances, reservations, sales-order lines, and ledger coverage.
- [ ] Make dispatch status changes idempotent so duplicate clicks cannot consume stock twice.
- [ ] Keep manual GRN as the only inward page action; stock damage, reserve release, and physical count corrections stay in inventory/stock-count controls.
- [ ] Keep tile master limited to size name, code, UOM, pcs-per-box, status, and sort order; tile design photos are not required.
- [ ] Update smoke tests to verify reconciliation in lead -> intent -> quote -> order -> reserve -> pending inward -> GRN -> dispatch -> return.
- [ ] Build API and web, run smoke tests, commit, reset the Railway database, deploy, and verify live routes.

## Release Gate

- `npm run build:api`
- `npm run build:web`
- Local GraphQL smoke for stock lifecycle and reconciliation
- Live Railway health and authenticated page checks after database reset and deploy


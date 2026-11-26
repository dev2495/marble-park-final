-- Settings switch "Expire quotes after their valid-until date". Off by default:
-- quotes behave as before (no sweep, no expiry on open, no validity refusal).
ALTER TABLE "AppSetting" ADD COLUMN IF NOT EXISTS "quoteExpiryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Business date on lot stock movements (stock count, opening stock). Null means
-- "use createdAt", so existing rows keep their meaning. Period close snapshots
-- filter on COALESCE("effectiveAt", "createdAt").
ALTER TABLE "InventoryLotLedgerEntry" ADD COLUMN IF NOT EXISTS "effectiveAt" TIMESTAMP(3);

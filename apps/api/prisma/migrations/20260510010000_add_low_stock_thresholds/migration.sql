-- Low-stock alert thresholds & explicit reorder points for inventory.
-- Default of 5 matches the "almost empty" heuristic the dashboard previously
-- hard-coded; safe for existing rows since it's a NOT NULL with default.
ALTER TABLE "InventoryBalance"
  ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "reorderPoint" INTEGER;

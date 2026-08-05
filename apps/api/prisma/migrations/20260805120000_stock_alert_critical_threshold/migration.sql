-- Critical stock alert tier (breach). Warning remains lowStockThreshold.
ALTER TABLE "InventoryBalance" ADD COLUMN "criticalStockThreshold" INTEGER;

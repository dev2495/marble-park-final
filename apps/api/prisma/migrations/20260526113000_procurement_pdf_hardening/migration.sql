-- Keep the procurement desk resilient across earlier branch schemas where
-- purchase orders existed before the dedicated procurement module.
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "vendorName" TEXT;
UPDATE "PurchaseOrder"
SET "vendorName" = COALESCE(NULLIF(BTRIM("vendorName"), ''), 'Vendor confirmation pending')
WHERE "vendorName" IS NULL OR BTRIM("vendorName") = '';
ALTER TABLE "PurchaseOrder" ALTER COLUMN "vendorName" SET DEFAULT 'Vendor confirmation pending';
ALTER TABLE "PurchaseOrder" ALTER COLUMN "vendorName" SET NOT NULL;

ALTER TABLE "GoodsReceiptNote" ADD COLUMN IF NOT EXISTS "vendorName" TEXT;
UPDATE "GoodsReceiptNote"
SET "vendorName" = COALESCE(NULLIF(BTRIM("vendorName"), ''), 'Vendor confirmation pending')
WHERE "vendorName" IS NULL OR BTRIM("vendorName") = '';
ALTER TABLE "GoodsReceiptNote" ALTER COLUMN "vendorName" SET DEFAULT 'Vendor confirmation pending';
ALTER TABLE "GoodsReceiptNote" ALTER COLUMN "vendorName" SET NOT NULL;

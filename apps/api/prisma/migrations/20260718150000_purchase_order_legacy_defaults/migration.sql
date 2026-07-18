-- Some long-lived databases still contain required legacy PurchaseOrder
-- columns from the pre-normalized procurement model. Keep those columns
-- compatible with Prisma creates until they are removed in a planned cleanup.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'PurchaseOrder'
      AND column_name = 'orderDate'
  ) THEN
    ALTER TABLE "PurchaseOrder"
      ALTER COLUMN "orderDate" SET DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

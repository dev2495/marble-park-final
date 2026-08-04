-- MRP is entered at quote time because the same catalogue SKU can be quoted
-- against different legal retail units or customer-facing price agreements.
-- Nullable columns preserve historical quotes while new commercial actions
-- require a positive snapshot through the application pricing contract.
ALTER TABLE "QuoteLine"
  ADD COLUMN "mrp" DOUBLE PRECISION,
  ADD COLUMN "mrpRateBasis" TEXT,
  ADD COLUMN "mrpSource" TEXT DEFAULT 'quote_entry';

ALTER TABLE "SalesOrderLine"
  ADD COLUMN "mrp" DOUBLE PRECISION,
  ADD COLUMN "mrpRateBasis" TEXT,
  ADD COLUMN "mrpSource" TEXT DEFAULT 'quote_entry';

CREATE INDEX "QuoteLine_mrp_idx" ON "QuoteLine"("mrp");
CREATE INDEX "SalesOrderLine_mrp_idx" ON "SalesOrderLine"("mrp");

-- Governed optional selling-floor policy. This is not a stock-cost authority.
ALTER TABLE "Product"
  ADD COLUMN "floorPriceInclusive" DECIMAL(18,2);

CREATE INDEX "Product_status_defaultMrpInclusive_idx"
  ON "Product"("status", "defaultMrpInclusive");

COMMENT ON COLUMN "Product"."floorPriceInclusive" IS
  'Optional tax-inclusive minimum selling rate in Product.priceUom; below-floor quotes require governed approval.';

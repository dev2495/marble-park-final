-- Complete the quote-pricing evidence model without guessing values for
-- historical products or commercial documents.
ALTER TABLE "Product"
  ADD COLUMN "mrp" DOUBLE PRECISION,
  ADD COLUMN "mrpRateBasis" TEXT,
  ADD COLUMN "mrpVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "mrpVerifiedById" TEXT,
  ADD COLUMN "mrpSource" TEXT;

ALTER TABLE "QuoteLine"
  ADD COLUMN "mrpConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "mrpConfirmedById" TEXT;

ALTER TABLE "SalesOrderLine"
  ADD COLUMN "mrpConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "mrpConfirmedById" TEXT;

CREATE INDEX "Product_mrp_idx" ON "Product"("mrp");
CREATE INDEX "Product_mrpRateBasis_idx" ON "Product"("mrpRateBasis");
CREATE INDEX "QuoteLine_mrpConfirmedById_idx" ON "QuoteLine"("mrpConfirmedById");
CREATE INDEX "InventoryBalance_available_updatedAt_idx" ON "InventoryBalance"("available", "updatedAt" DESC);
CREATE INDEX "InventoryBalance_reserved_updatedAt_idx" ON "InventoryBalance"("reserved", "updatedAt" DESC);
CREATE INDEX "SalesOrder_promisedDate_status_idx" ON "SalesOrder"("promisedDate", "status");
CREATE INDEX "SalesOrderLine_status_createdAt_id_idx" ON "SalesOrderLine"("status", "createdAt" DESC, "id");
CREATE INDEX "InventoryLot_productId_receivedAt_id_idx" ON "InventoryLot"("productId", "receivedAt", "id");

ALTER TABLE "SalesOrder"
  ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesOrder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesOrderLine"
  ADD CONSTRAINT "SalesOrderLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

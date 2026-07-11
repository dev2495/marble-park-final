-- Client workflow completion: immutable commercial snapshots, partial orders,
-- and order-owned downstream execution. This migration is additive first,
-- backfills legacy one-order quotes, then removes the quote-level uniqueness
-- constraints that prevented repeated partial conversions.

ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "promisedDate" TIMESTAMP(3);

ALTER TABLE "DispatchJob" ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT;
ALTER TABLE "DispatchChallan" ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "salesOrderLineId" TEXT;

ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "orderedQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "cancelledQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "closedQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "listPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 18;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "grossLineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "listPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 18;
ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "grossLineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Every legacy quote could have at most one order/job. Attach those records
-- before relaxing uniqueness so their stock, receipts, and challans stay owned.
UPDATE "DispatchJob" AS job
SET "salesOrderId" = so."id"
FROM "SalesOrder" AS so
WHERE job."salesOrderId" IS NULL
  AND so."quoteId" = job."quoteId";

UPDATE "DispatchChallan" AS challan
SET "salesOrderId" = job."salesOrderId"
FROM "DispatchJob" AS job
WHERE challan."salesOrderId" IS NULL
  AND challan."dispatchJobId" = job."id";

UPDATE "Reservation" AS reservation
SET "salesOrderId" = so."id"
FROM "SalesOrder" AS so
WHERE reservation."salesOrderId" IS NULL
  AND reservation."quoteId" = so."quoteId";

UPDATE "QuoteLine"
SET "listPrice" = CASE WHEN "listPrice" = 0 THEN "unitPrice" ELSE "listPrice" END,
    "taxableValue" = CASE WHEN "taxableValue" = 0 THEN "lineTotal" ELSE "taxableValue" END,
    "grossLineTotal" = CASE WHEN "grossLineTotal" = 0 THEN "lineTotal" ELSE "grossLineTotal" END;

UPDATE "SalesOrderLine"
SET "listPrice" = CASE WHEN "listPrice" = 0 THEN "unitPrice" ELSE "listPrice" END,
    "taxableValue" = CASE WHEN "taxableValue" = 0 THEN "lineTotal" ELSE "taxableValue" END,
    "grossLineTotal" = CASE WHEN "grossLineTotal" = 0 THEN "lineTotal" ELSE "grossLineTotal" END;

UPDATE "QuoteLine" AS line
SET "orderedQuantity" = line."quantity",
    "status" = 'fully_ordered'
WHERE EXISTS (SELECT 1 FROM "SalesOrder" AS so WHERE so."quoteId" = line."quoteId");

DROP INDEX IF EXISTS "SalesOrder_quoteId_key";
DROP INDEX IF EXISTS "DispatchJob_quoteId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "SalesOrder_idempotencyKey_key" ON "SalesOrder"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "SalesOrder_quoteId_idx" ON "SalesOrder"("quoteId");
CREATE UNIQUE INDEX IF NOT EXISTS "DispatchJob_salesOrderId_key" ON "DispatchJob"("salesOrderId");
CREATE INDEX IF NOT EXISTS "DispatchJob_quoteId_idx" ON "DispatchJob"("quoteId");
CREATE INDEX IF NOT EXISTS "DispatchChallan_salesOrderId_idx" ON "DispatchChallan"("salesOrderId");
CREATE INDEX IF NOT EXISTS "Reservation_salesOrderId_status_idx" ON "Reservation"("salesOrderId", "status");
CREATE INDEX IF NOT EXISTS "Reservation_salesOrderLineId_idx" ON "Reservation"("salesOrderLineId");
CREATE INDEX IF NOT EXISTS "AuditEvent_action_created_idx" ON "AuditEvent"("action", "createdAt" DESC);

-- These constraints are added NOT VALID so production migration is safe on
-- historical data while all new writes are enforced immediately. A release
-- gate validates them after backfill reconciliation succeeds.
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DispatchJob" ADD CONSTRAINT "DispatchJob_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DispatchChallan" ADD CONSTRAINT "DispatchChallan_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

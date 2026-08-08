ALTER TABLE "DispatchChallan" ALTER COLUMN "quoteId" DROP NOT NULL;
ALTER TABLE "DispatchJob" ALTER COLUMN "quoteId" DROP NOT NULL;
ALTER TABLE "Reservation" ALTER COLUMN "quoteId" DROP NOT NULL;
ALTER TABLE "SalesOrder" ALTER COLUMN "quoteId" DROP NOT NULL;
ALTER TABLE "SalesOrderLine" ALTER COLUMN "quoteId" DROP NOT NULL;
ALTER TABLE "CreditNote" ADD COLUMN "unappliedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE "CreditNote" credit_note
SET "unappliedAmount" = CASE
  WHEN credit_note."status" <> 'issued' OR LOWER(credit_note."refundMode") = 'refund' THEN 0
  ELSE GREATEST(
    0,
    credit_note."amount" - COALESCE((
      SELECT SUM(allocation."amount")
      FROM "CustomerAllocation" allocation
      WHERE allocation."sourceType" = 'CreditNote'
        AND allocation."sourceId" = credit_note."id"
        AND allocation."status" = 'posted'
    ), 0)
  )
END;

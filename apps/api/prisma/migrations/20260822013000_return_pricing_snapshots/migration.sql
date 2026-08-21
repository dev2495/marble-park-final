ALTER TABLE "ReturnLine"
  ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'PC',
  ADD COLUMN "pricingVersion" TEXT NOT NULL DEFAULT 'legacy_unverified',
  ADD COLUMN "priceRateBasis" TEXT,
  ADD COLUMN "mrpInclusive" DECIMAL(18,2),
  ADD COLUMN "nrpMode" TEXT,
  ADD COLUMN "nrpInput" DECIMAL(18,6),
  ADD COLUMN "nrpInclusive" DECIMAL(18,2),
  ADD COLUMN "specialMode" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "specialInput" DECIMAL(18,6),
  ADD COLUMN "specialRateInclusive" DECIMAL(18,2),
  ADD COLUMN "quoteDiscountAllocatedInclusive" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxableValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "grossLineTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "costSnapshot" DECIMAL(18,4),
  ADD COLUMN "costSnapshotSource" TEXT,
  ADD COLUMN "costSnapshotAt" TIMESTAMP(3);

COMMENT ON COLUMN "ReturnLine"."pricingVersion" IS
  'Existing return lines stay legacy_unverified. New lines copy the invoice/order pricing snapshot; no historical price is guessed.';

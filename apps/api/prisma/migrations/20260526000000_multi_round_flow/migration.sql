ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "reopenedAt" TIMESTAMP(3);

ALTER TABLE "LeadIntent" ADD COLUMN IF NOT EXISTS "referencesQuoteId" TEXT;
ALTER TABLE "LeadIntent" ADD COLUMN IF NOT EXISTS "lockedBy" TEXT;
ALTER TABLE "LeadIntent" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
ALTER TABLE "LeadIntent" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "LeadIntent_referencesQuoteId_idx" ON "LeadIntent"("referencesQuoteId");
CREATE INDEX IF NOT EXISTS "LeadIntent_lockedBy_idx" ON "LeadIntent"("lockedBy");

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "intentId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "supersedesQuoteId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "supersededByQuoteId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "versionNumber" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "Quote_intentId_idx" ON "Quote"("intentId");
CREATE INDEX IF NOT EXISTS "Quote_supersedesQuoteId_idx" ON "Quote"("supersedesQuoteId");
CREATE INDEX IF NOT EXISTS "Quote_supersededByQuoteId_idx" ON "Quote"("supersededByQuoteId");

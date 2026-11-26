-- Sales lane: a walk-in visit remembers the quote it turned into.
ALTER TABLE "ShowroomVisit" ADD COLUMN IF NOT EXISTS "quoteId" TEXT;
CREATE INDEX IF NOT EXISTS "ShowroomVisit_quoteId_idx" ON "ShowroomVisit"("quoteId");

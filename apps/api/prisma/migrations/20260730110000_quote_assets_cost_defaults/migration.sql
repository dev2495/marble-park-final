-- Optional procurement costs fall back to the SKU's default purchase cost at GRN.
ALTER TABLE "Product"
ADD COLUMN "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- New quotations inherit this global footer-brand policy. Existing quotations
-- retain any explicit selectedBrandIds stored in quoteMeta.
ALTER TABLE "AppSetting"
ADD COLUMN "quoteBrandSelectionMode" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN "quoteBrandIds" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "QuoteShare" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "allowDownload" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuoteShare_token_key" ON "QuoteShare"("token");
CREATE INDEX "QuoteShare_quoteId_createdAt_idx" ON "QuoteShare"("quoteId", "createdAt" DESC);
CREATE INDEX "QuoteShare_expiresAt_idx" ON "QuoteShare"("expiresAt");
CREATE INDEX "QuoteShare_revokedAt_idx" ON "QuoteShare"("revokedAt");

ALTER TABLE "QuoteShare"
ADD CONSTRAINT "QuoteShare_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

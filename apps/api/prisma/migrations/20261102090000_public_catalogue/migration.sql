-- Phase 2: customer product pages without a login.
-- Printed shelf stickers are unchanged; customers reach products through the
-- showroom scan page, staff share links and the catalogue's on-screen QR.

ALTER TABLE "AppSetting"
  ADD COLUMN "publicCatalogueEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "publicPriceMode" TEXT NOT NULL DEFAULT 'mrp';

ALTER TABLE "Product" ADD COLUMN "publicToken" TEXT;
CREATE UNIQUE INDEX "Product_publicToken_key" ON "Product"("publicToken");

CREATE TABLE "ProductPublicStat" (
  "productId" TEXT NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "qrScans" INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductPublicStat_pkey" PRIMARY KEY ("productId"),
  CONSTRAINT "ProductPublicStat_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CatalogueShare" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "productIds" JSONB NOT NULL DEFAULT '[]',
  "createdBy" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogueShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogueShare_token_key" ON "CatalogueShare"("token");
CREATE INDEX "CatalogueShare_createdBy_createdAt_idx" ON "CatalogueShare"("createdBy", "createdAt" DESC);
CREATE INDEX "CatalogueShare_expiresAt_idx" ON "CatalogueShare"("expiresAt");

-- Persistent, searchable file vault with revocable public share links.
CREATE TABLE "VaultAsset" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'General',
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "mediaKind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "uploadedBy" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VaultShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "allowDownload" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VaultAsset_storageKey_key" ON "VaultAsset"("storageKey");
CREATE INDEX "VaultAsset_status_createdAt_idx" ON "VaultAsset"("status", "createdAt" DESC);
CREATE INDEX "VaultAsset_category_status_idx" ON "VaultAsset"("category", "status");
CREATE INDEX "VaultAsset_mediaKind_status_idx" ON "VaultAsset"("mediaKind", "status");
CREATE INDEX "VaultAsset_uploadedBy_idx" ON "VaultAsset"("uploadedBy");
CREATE UNIQUE INDEX "VaultShare_token_key" ON "VaultShare"("token");
CREATE INDEX "VaultShare_assetId_revokedAt_idx" ON "VaultShare"("assetId", "revokedAt");
CREATE INDEX "VaultShare_expiresAt_idx" ON "VaultShare"("expiresAt");
CREATE INDEX "VaultShare_createdBy_idx" ON "VaultShare"("createdBy");

ALTER TABLE "VaultShare" ADD CONSTRAINT "VaultShare_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "VaultAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

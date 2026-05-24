CREATE TABLE "TileSize" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'BOX',
    "pcsPerBox" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TileSize_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TileSize_name_key" ON "TileSize"("name");
CREATE INDEX "TileSize_status_idx" ON "TileSize"("status");
CREATE INDEX "TileSize_sortOrder_idx" ON "TileSize"("sortOrder");

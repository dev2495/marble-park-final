-- Additive tile catalogue, governed geometry and display-asset lifecycle.
-- Product remains the single inwardable/saleable stock identity, so every
-- existing ledger, lot, reservation and commercial reference remains valid.

ALTER TABLE "TileSize"
  ADD COLUMN "widthMm" DOUBLE PRECISION,
  ADD COLUMN "heightMm" DOUBLE PRECISION,
  ADD COLUMN "thicknessMm" DOUBLE PRECISION,
  ADD COLUMN "areaPerPieceSqM" DOUBLE PRECISION,
  ADD COLUMN "areaPerPieceSqFt" DOUBLE PRECISION,
  ADD COLUMN "areaPerBoxSqM" DOUBLE PRECISION,
  ADD COLUMN "areaPerBoxSqFt" DOUBLE PRECISION;

CREATE INDEX "TileSize_status_sortOrder_idx" ON "TileSize"("status", "sortOrder");

-- Recover governed geometry from the existing size code/name when the two
-- dimensions are unambiguous (for example 600X1200). Preserve any value that
-- an operator already captured and record every inferred master-data change.
WITH parsed AS (
  SELECT ts."id",
    (dimensions[1])::DOUBLE PRECISION AS width_mm,
    (dimensions[2])::DOUBLE PRECISION AS height_mm
  FROM "TileSize" ts
  CROSS JOIN LATERAL regexp_match(
    upper(COALESCE(ts."code", '') || ' ' || COALESCE(ts."name", '')),
    E'([0-9]{2,5})\\s*[X×]\\s*([0-9]{2,5})'
  ) AS dimensions
), backfilled AS (
  UPDATE "TileSize" ts
  SET "widthMm" = COALESCE(ts."widthMm", parsed.width_mm),
      "heightMm" = COALESCE(ts."heightMm", parsed.height_mm),
      "areaPerPieceSqM" = COALESCE(ts."areaPerPieceSqM", parsed.width_mm * parsed.height_mm / 1000000.0),
      "areaPerPieceSqFt" = COALESCE(ts."areaPerPieceSqFt", parsed.width_mm * parsed.height_mm / 1000000.0 * 10.7639104167),
      "areaPerBoxSqM" = COALESCE(ts."areaPerBoxSqM", parsed.width_mm * parsed.height_mm / 1000000.0 * greatest(ts."pcsPerBox", 1)),
      "areaPerBoxSqFt" = COALESCE(ts."areaPerBoxSqFt", parsed.width_mm * parsed.height_mm / 1000000.0 * 10.7639104167 * greatest(ts."pcsPerBox", 1)),
      "updatedAt" = CURRENT_TIMESTAMP
  FROM parsed
  WHERE ts."id" = parsed."id"
    AND (
      ts."widthMm" IS NULL OR ts."heightMm" IS NULL OR
      ts."areaPerPieceSqM" IS NULL OR ts."areaPerPieceSqFt" IS NULL OR
      ts."areaPerBoxSqM" IS NULL OR ts."areaPerBoxSqFt" IS NULL
    )
  RETURNING ts."id", ts."code", ts."widthMm", ts."heightMm",
    ts."areaPerPieceSqM", ts."areaPerPieceSqFt", ts."areaPerBoxSqM", ts."areaPerBoxSqFt"
)
INSERT INTO "AuditEvent" ("id", "actorUserId", "action", "entityType", "entityId", "summary", "metadata", "createdAt")
SELECT 'MIG-TILE-SIZE-GEOMETRY-' || backfilled."id", 'system:migration', 'master.tile_size.geometry_backfill',
  'TileSize', backfilled."id", 'Backfilled tile size geometry from its governed code or name',
  jsonb_build_object(
    'code', backfilled."code",
    'widthMm', backfilled."widthMm",
    'heightMm', backfilled."heightMm",
    'areaPerPieceSqM', backfilled."areaPerPieceSqM",
    'areaPerPieceSqFt', backfilled."areaPerPieceSqFt",
    'areaPerBoxSqM', backfilled."areaPerBoxSqM",
    'areaPerBoxSqFt', backfilled."areaPerBoxSqFt",
    'source', 'deterministic_dimension_parse'
  ), CURRENT_TIMESTAMP
FROM backfilled;

-- Older setup allowed the same size code for pack variants. Packing belongs on
-- Product/TileVariant, so retain every row but give secondary rows an explicit,
-- deterministic code. Prefer the code already referenced by the most SKUs.
WITH ranked AS (
  SELECT ts."id", ts."code", ts."pcsPerBox",
    row_number() OVER (
      PARTITION BY ts."code"
      ORDER BY (SELECT count(*) FROM "Product" p WHERE p."tileSizeId" = ts."id") DESC, ts."createdAt" ASC, ts."id" ASC
    ) AS duplicate_rank
  FROM "TileSize" ts
  WHERE ts."code" IS NOT NULL
), corrected AS (
  UPDATE "TileSize" ts
  SET "code" = ranked."code" || '-' || greatest(ranked."pcsPerBox", 1)::text || 'PC-' || ranked.duplicate_rank::text,
      "updatedAt" = CURRENT_TIMESTAMP
  FROM ranked
  WHERE ts."id" = ranked."id" AND ranked.duplicate_rank > 1
  RETURNING ts."id", ranked."code" AS old_code, ts."code" AS new_code
)
INSERT INTO "AuditEvent" ("id", "actorUserId", "action", "entityType", "entityId", "summary", "metadata", "createdAt")
SELECT 'MIG-TILE-SIZE-' || corrected."id", 'system:migration', 'master.tile_size.code_normalize', 'TileSize', corrected."id",
  'Normalized duplicate tile size code ' || corrected.old_code || ' to ' || corrected.new_code,
  jsonb_build_object('oldCode', corrected.old_code, 'newCode', corrected.new_code, 'reason', 'packing moved to tile variant'), CURRENT_TIMESTAMP
FROM corrected;

CREATE UNIQUE INDEX "TileSize_code_key" ON "TileSize"("code");

CREATE TABLE "TileDesign" (
  "id" TEXT NOT NULL,
  "designCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT NOT NULL DEFAULT '',
  "collection" TEXT,
  "material" TEXT,
  "surface" TEXT,
  "style" TEXT,
  "colour" TEXT,
  "pattern" TEXT,
  "usage" JSONB NOT NULL DEFAULT '[]',
  "origin" TEXT,
  "description" TEXT NOT NULL DEFAULT '',
  "media" JSONB NOT NULL DEFAULT '{}',
  "tags" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TileDesign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TileDesign_designCode_key" ON "TileDesign"("designCode");
CREATE INDEX "TileDesign_name_idx" ON "TileDesign"("name");
CREATE INDEX "TileDesign_brand_idx" ON "TileDesign"("brand");
CREATE INDEX "TileDesign_surface_idx" ON "TileDesign"("surface");
CREATE INDEX "TileDesign_status_updatedAt_idx" ON "TileDesign"("status", "updatedAt" DESC);

ALTER TABLE "Product" ADD COLUMN "tileDesignId" TEXT;
CREATE INDEX "Product_tileDesignId_tileSizeId_status_idx" ON "Product"("tileDesignId", "tileSizeId", "status");
ALTER TABLE "Product" ADD CONSTRAINT "Product_tileDesignId_fkey"
  FOREIGN KEY ("tileDesignId") REFERENCES "TileDesign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DisplaySample"
  ADD COLUMN "sourceLotId" TEXT,
  ADD COLUMN "issuedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "condition" TEXT NOT NULL DEFAULT 'good',
  ADD COLUMN "lastInspectedAt" TIMESTAMP(3),
  ADD COLUMN "nextInspectionAt" TIMESTAMP(3),
  ADD COLUMN "removalReason" TEXT;

CREATE INDEX "DisplaySample_sourceLotId_idx" ON "DisplaySample"("sourceLotId");
CREATE INDEX "DisplaySample_nextInspectionAt_idx" ON "DisplaySample"("nextInspectionAt");

CREATE TABLE "DisplaySampleEvent" (
  "id" TEXT NOT NULL,
  "displaySampleId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisplaySampleEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DisplaySampleEvent_displaySampleId_createdAt_idx" ON "DisplaySampleEvent"("displaySampleId", "createdAt" DESC);
CREATE INDEX "DisplaySampleEvent_action_createdAt_idx" ON "DisplaySampleEvent"("action", "createdAt" DESC);

-- Existing tile Product rows remain usable immediately. They receive a
-- catalogue design record deterministically and retain their exact SKU/code.
INSERT INTO "TileDesign" (
  "id", "designCode", "name", "brand", "surface", "description", "media", "tags", "status", "metadata", "createdAt", "updatedAt"
)
SELECT
  'TD-' || p."id",
  COALESCE(NULLIF(p."internalCode", ''), p."sku"),
  p."name",
  COALESCE(p."brand", ''),
  NULLIF(p."finish", ''),
  COALESCE(p."description", ''),
  COALESCE(p."media", '{}'::jsonb),
  COALESCE(p."tags", '[]'::jsonb),
  p."status",
  jsonb_build_object('migratedFromProductId', p."id", 'source', 'additive_tile_design_migration'),
  p."createdAt",
  CURRENT_TIMESTAMP
FROM "Product" p
WHERE lower(p."category") = 'tiles'
ON CONFLICT ("designCode") DO NOTHING;

UPDATE "Product" p
SET "tileDesignId" = td."id"
FROM "TileDesign" td
WHERE lower(p."category") = 'tiles'
  AND td."designCode" = COALESCE(NULLIF(p."internalCode", ''), p."sku")
  AND p."tileDesignId" IS NULL;

-- Search paths used by 10k+ design catalogues and daily procurement registers.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "TileDesign_designCode_trgm_idx" ON "TileDesign" USING GIN ("designCode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "TileDesign_name_trgm_idx" ON "TileDesign" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "TileDesign_brand_trgm_idx" ON "TileDesign" USING GIN ("brand" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "TileDesign_collection_trgm_idx" ON "TileDesign" USING GIN ("collection" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DisplaySample_internalCode_trgm_idx" ON "DisplaySample" USING GIN ("internalCode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DisplaySample_sampleNumber_trgm_idx" ON "DisplaySample" USING GIN ("sampleNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PurchaseOrder_poNumber_trgm_idx" ON "PurchaseOrder" USING GIN ("poNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PurchaseOrder_vendorName_trgm_idx" ON "PurchaseOrder" USING GIN ("vendorName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GoodsReceiptNote_grnNumber_trgm_idx" ON "GoodsReceiptNote" USING GIN ("grnNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GoodsReceiptNote_vendorName_trgm_idx" ON "GoodsReceiptNote" USING GIN ("vendorName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GoodsReceiptNote_supplierChallan_trgm_idx" ON "GoodsReceiptNote" USING GIN ("supplierChallan" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PurchaseDemand_sku_trgm_idx" ON "PurchaseDemand" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PurchaseDemand_name_trgm_idx" ON "PurchaseDemand" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_sku_trgm_idx" ON "PurchaseOrderLine" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_name_trgm_idx" ON "PurchaseOrderLine" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_brand_trgm_idx" ON "PurchaseOrderLine" USING GIN ("brand" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GoodsReceiptLine_sku_trgm_idx" ON "GoodsReceiptLine" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GoodsReceiptLine_name_trgm_idx" ON "GoodsReceiptLine" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GoodsReceiptLine_lotId_trgm_idx" ON "GoodsReceiptLine" USING GIN ("lotId" gin_trgm_ops);

-- Governing parent relations make line-level search and drill-through efficient
-- without duplicating free-text search blobs on document headers.
ALTER TABLE "PurchaseOrderLine"
  ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceiptLine"
  ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptNoteId_fkey"
  FOREIGN KEY ("goodsReceiptNoteId") REFERENCES "GoodsReceiptNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

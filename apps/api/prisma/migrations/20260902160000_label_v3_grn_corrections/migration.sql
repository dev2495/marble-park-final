ALTER TABLE "GoodsReceiptNote"
ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "InternalLabelTemplate"
SET "status" = 'archived', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'thermal_4x2'
  AND "status" = 'active';

INSERT INTO "InternalLabelTemplate" (
  "id", "code", "version", "name", "subjectTypes", "paperType", "widthMm", "heightMm",
  "pageWidthMm", "pageHeightMm", "columns", "rows", "gapXMm", "gapYMm",
  "marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm", "definition", "updatedAt"
) VALUES (
  'label-template-thermal-4x2-v3',
  'thermal_4x2',
  3,
  '2 x 4 inch portrait sticker - compact identity v3',
  '["product","inventory_lot","display_sample"]',
  'thermal',
  50.8,
  101.6,
  50.8,
  101.6,
  1,
  1,
  0,
  0,
  0,
  0,
  0,
  0,
  '{"showQr":true,"showHumanCode":true,"layout":"marble_park_4x2_v3","orientation":"portrait","safeMarginMm":1.9,"content":"brand_product_rate_no_lot"}',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code", "version") DO UPDATE SET
  "name" = EXCLUDED."name",
  "subjectTypes" = EXCLUDED."subjectTypes",
  "paperType" = EXCLUDED."paperType",
  "widthMm" = EXCLUDED."widthMm",
  "heightMm" = EXCLUDED."heightMm",
  "pageWidthMm" = EXCLUDED."pageWidthMm",
  "pageHeightMm" = EXCLUDED."pageHeightMm",
  "columns" = EXCLUDED."columns",
  "rows" = EXCLUDED."rows",
  "definition" = EXCLUDED."definition",
  "status" = 'active',
  "updatedAt" = CURRENT_TIMESTAMP;

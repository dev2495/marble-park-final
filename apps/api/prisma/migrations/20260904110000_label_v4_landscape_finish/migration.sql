-- New runs use the printer-feed 4 x 2 inch layout. Historical runs retain their version.
UPDATE "InternalLabelTemplate"
SET "status" = 'archived', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'thermal_4x2' AND "status" = 'active' AND "version" < 4;

INSERT INTO "InternalLabelTemplate" (
  "id", "code", "version", "name", "subjectTypes", "paperType", "widthMm", "heightMm",
  "pageWidthMm", "pageHeightMm", "columns", "rows", "gapXMm", "gapYMm",
  "marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm", "definition", "updatedAt"
) VALUES (
  'label-template-thermal-4x2-v4', 'thermal_4x2', 4,
  '4 x 2 inch sticker - codes, finish and rate',
  '["product","inventory_lot","display_sample"]', 'thermal',
  101.6, 50.8, 101.6, 50.8, 1, 1, 0, 0, 0, 0, 0, 0,
  '{"showQr":true,"showHumanCode":true,"layout":"marble_park_4x2_v4","orientation":"landscape","safeMarginMm":1.8,"content":"brand_product_finish_rate_no_lot"}',
  CURRENT_TIMESTAMP
) ON CONFLICT ("code", "version") DO NOTHING;

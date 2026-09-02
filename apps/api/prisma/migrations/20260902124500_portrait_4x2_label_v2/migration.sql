UPDATE "InternalLabelTemplate"
SET "status" = 'archived', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'thermal_4x2'
  AND "status" = 'active';

INSERT INTO "InternalLabelTemplate" (
  "id", "code", "version", "name", "subjectTypes", "paperType", "widthMm", "heightMm",
  "pageWidthMm", "pageHeightMm", "columns", "rows", "gapXMm", "gapYMm",
  "marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm", "definition", "updatedAt"
) VALUES (
  'label-template-thermal-4x2-v2',
  'thermal_4x2',
  2,
  '2 x 4 inch portrait sticker - 50.8 x 101.6 mm',
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
  '{"showQr":true,"showHumanCode":true,"layout":"marble_park_4x2_v2","orientation":"portrait","safeMarginMm":1.9,"content":"codes_and_rate"}',
  CURRENT_TIMESTAMP
);

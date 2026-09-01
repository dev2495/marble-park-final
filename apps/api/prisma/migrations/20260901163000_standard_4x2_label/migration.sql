UPDATE "InternalLabelTemplate"
SET "status" = 'archived', "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'active'
  AND "code" IN ('a4_70x37', 'thermal_100x50', 'thermal_50x30');

INSERT INTO "InternalLabelTemplate" (
  "id", "code", "version", "name", "subjectTypes", "paperType", "widthMm", "heightMm",
  "pageWidthMm", "pageHeightMm", "columns", "rows", "gapXMm", "gapYMm",
  "marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm", "definition", "updatedAt"
) VALUES (
  'label-template-thermal-4x2-v1',
  'thermal_4x2',
  1,
  '4 x 2 inch sticker - 101.6 x 50.8 mm',
  '["product","inventory_lot","display_sample"]',
  'thermal',
  101.6,
  50.8,
  101.6,
  50.8,
  1,
  1,
  0,
  0,
  0,
  0,
  0,
  0,
  '{"showQr":true,"showHumanCode":true,"layout":"marble_park_4x2_v1","orientation":"landscape","safeMarginMm":2.4}',
  CURRENT_TIMESTAMP
);

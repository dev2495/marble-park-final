INSERT INTO "UnitOfMeasure" ("id", "code", "name", "dimension", "decimalScale", "status", "sortOrder", "metadata", "updatedAt") VALUES
  ('uom-sqft', 'SQFT', 'Square foot', 'area', 3, 'active', 45, '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "dimension" = EXCLUDED."dimension",
  "decimalScale" = EXCLUDED."decimalScale",
  "status" = EXCLUDED."status",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

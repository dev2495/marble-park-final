-- Chemicals such as tile adhesive are sold in sealed bags as well as loose by KG.
INSERT INTO "UnitOfMeasure" ("id", "code", "name", "dimension", "decimalScale", "status", "sortOrder", "metadata", "updatedAt") VALUES
  ('uom-bag', 'BAG', 'Bag', 'count', 0, 'active', 75, '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "dimension" = EXCLUDED."dimension",
  "decimalScale" = EXCLUDED."decimalScale",
  "status" = 'active',
  "updatedAt" = CURRENT_TIMESTAMP;

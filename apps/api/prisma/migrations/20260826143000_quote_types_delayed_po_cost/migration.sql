-- Persist the customer-facing quotation family so the register can filter and
-- sort without scanning JSON line snapshots.
ALTER TABLE "Quote"
  ADD COLUMN "quoteType" TEXT NOT NULL DEFAULT 'cp_sanitary';

-- Existing documents remain usable. Any historical quote containing a tile or
-- chemical line is presented with the Tile family; all others remain
-- CP/Sanitary. New writes are validated strictly by the API.
UPDATE "Quote" q
SET "quoteType" = 'tile'
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(q."lines") = 'array' THEN q."lines" ELSE '[]'::jsonb END
  ) AS line
  WHERE LOWER(BTRIM(COALESCE(line->>'category', ''))) IN ('tiles', 'chemicals')
);

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_quoteType_check"
  CHECK ("quoteType" IN ('tile', 'cp_sanitary'));

CREATE INDEX "Quote_quoteType_createdAt_idx"
  ON "Quote"("quoteType", "createdAt" DESC);
CREATE INDEX "Quote_quoteType_status_createdAt_idx"
  ON "Quote"("quoteType", "status", "createdAt" DESC);

-- KG is already part of the universal UOM migration, but the idempotent seed
-- keeps older upgraded databases safe. Chemicals belong only to Tile quotes.
INSERT INTO "UnitOfMeasure"
  ("id", "code", "name", "dimension", "decimalScale", "status", "sortOrder", "metadata", "updatedAt")
VALUES
  ('uom-kg', 'KG', 'Kilogram', 'weight', 3, 'active', 70, '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "dimension" = EXCLUDED."dimension",
  "decimalScale" = EXCLUDED."decimalScale",
  "status" = 'active',
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "ProductCategory"
  ("id", "name", "code", "description", "status", "sortOrder", "metadata", "updatedAt")
VALUES
  (
    'category-chemicals',
    'Chemicals',
    'CHEM',
    'Tile adhesives, grouts, sealants and installation chemicals governed in kilograms.',
    'active',
    85,
    '{"quoteFamily":"tile","defaultUom":"KG","allowedQuoteTypes":["tile"]}',
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("name") DO UPDATE SET
  "code" = COALESCE("ProductCategory"."code", EXCLUDED."code"),
  "description" = EXCLUDED."description",
  "status" = 'active',
  "metadata" = EXCLUDED."metadata",
  "updatedAt" = CURRENT_TIMESTAMP;

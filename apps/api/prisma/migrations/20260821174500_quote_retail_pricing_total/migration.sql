-- Materialize the authoritative quote total so the high-volume register can
-- sort and paginate by value without recalculating unindexed JSON in the UI.
ALTER TABLE "Quote" ADD COLUMN "commercialTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "Quote" q
SET "commercialTotal" = COALESCE(
  CASE
    WHEN jsonb_typeof(q."approval" -> 'pricing' -> 'grandTotal') = 'number'
      THEN (q."approval" -> 'pricing' ->> 'grandTotal')::DOUBLE PRECISION
    ELSE NULL
  END,
  (
    SELECT COALESCE(SUM(
      CASE
        WHEN jsonb_typeof(row -> 'grossLineTotal') = 'number' THEN (row ->> 'grossLineTotal')::DOUBLE PRECISION
        WHEN jsonb_typeof(row -> 'total') = 'number' THEN (row ->> 'total')::DOUBLE PRECISION
        ELSE 0
      END
    ), 0)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q."lines") = 'array' THEN q."lines" ELSE '[]'::jsonb END) row
  ),
  0
);

CREATE INDEX "Quote_commercialTotal_idx" ON "Quote"("commercialTotal");
CREATE INDEX "Quote_status_commercialTotal_idx" ON "Quote"("status", "commercialTotal" DESC);

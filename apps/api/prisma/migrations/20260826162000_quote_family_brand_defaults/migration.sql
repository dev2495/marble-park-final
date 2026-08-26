-- Quotation footer brands are governed globally by commercial family. Keep
-- the legacy shared fields for older clients, while backfilling both new
-- policies so the release is behaviour-preserving until an owner changes one.
ALTER TABLE "AppSetting"
  ADD COLUMN "tileQuoteBrandSelectionMode" TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN "tileQuoteBrandIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "cpSanitaryQuoteBrandSelectionMode" TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN "cpSanitaryQuoteBrandIds" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "AppSetting"
SET
  "tileQuoteBrandSelectionMode" = COALESCE("quoteBrandSelectionMode", 'all'),
  "tileQuoteBrandIds" = COALESCE("quoteBrandIds", '[]'::jsonb),
  "cpSanitaryQuoteBrandSelectionMode" = COALESCE("quoteBrandSelectionMode", 'all'),
  "cpSanitaryQuoteBrandIds" = COALESCE("quoteBrandIds", '[]'::jsonb);

ALTER TABLE "AppSetting"
  ADD CONSTRAINT "AppSetting_tileQuoteBrandSelectionMode_check"
    CHECK ("tileQuoteBrandSelectionMode" IN ('all', 'selected', 'none')),
  ADD CONSTRAINT "AppSetting_cpSanitaryQuoteBrandSelectionMode_check"
    CHECK ("cpSanitaryQuoteBrandSelectionMode" IN ('all', 'selected', 'none'));

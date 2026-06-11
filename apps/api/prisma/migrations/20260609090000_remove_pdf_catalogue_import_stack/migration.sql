-- Remove the unreliable PDF catalogue extraction/review workflow.
-- Product creation remains manual or Excel-driven through Product Master.
DROP TABLE IF EXISTS "CatalogReviewTask";
DROP TABLE IF EXISTS "ImportRow";
DROP TABLE IF EXISTS "ImportBatch";
DROP TABLE IF EXISTS "SourceFile";

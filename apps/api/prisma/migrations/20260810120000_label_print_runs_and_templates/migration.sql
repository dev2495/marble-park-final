ALTER TABLE "InternalLabelJob"
  ADD COLUMN "templateVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "labelTemplateId" TEXT;

CREATE TABLE "InternalLabelTemplate" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "name" TEXT NOT NULL,
  "subjectTypes" JSONB NOT NULL DEFAULT '[]',
  "paperType" TEXT NOT NULL DEFAULT 'sheet',
  "widthMm" DOUBLE PRECISION NOT NULL,
  "heightMm" DOUBLE PRECISION NOT NULL,
  "pageWidthMm" DOUBLE PRECISION,
  "pageHeightMm" DOUBLE PRECISION,
  "columns" INTEGER NOT NULL DEFAULT 1,
  "rows" INTEGER NOT NULL DEFAULT 1,
  "gapXMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gapYMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "marginTopMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "marginRightMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "marginBottomMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "marginLeftMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "definition" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InternalLabelTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalLabelPrintRun" (
  "id" TEXT NOT NULL,
  "runNumber" TEXT NOT NULL,
  "labelJobId" TEXT NOT NULL,
  "templateCode" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL DEFAULT 1,
  "selectedLabelIds" JSONB NOT NULL,
  "copies" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "reason" TEXT,
  "cancelReason" TEXT,
  "requestedBy" TEXT NOT NULL,
  "confirmedBy" TEXT,
  "cancelledBy" TEXT,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InternalLabelPrintRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InternalLabelTemplate_code_version_key" ON "InternalLabelTemplate"("code", "version");
CREATE INDEX "InternalLabelTemplate_status_code_idx" ON "InternalLabelTemplate"("status", "code");
CREATE UNIQUE INDEX "InternalLabelPrintRun_runNumber_key" ON "InternalLabelPrintRun"("runNumber");
CREATE INDEX "InternalLabelPrintRun_labelJobId_createdAt_idx" ON "InternalLabelPrintRun"("labelJobId", "createdAt" DESC);
CREATE INDEX "InternalLabelPrintRun_status_createdAt_idx" ON "InternalLabelPrintRun"("status", "createdAt" DESC);

ALTER TABLE "InternalLabelPrintRun" ADD CONSTRAINT "InternalLabelPrintRun_labelJobId_fkey"
  FOREIGN KEY ("labelJobId") REFERENCES "InternalLabelJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "InternalLabelTemplate" (
  "id", "code", "version", "name", "subjectTypes", "paperType", "widthMm", "heightMm",
  "pageWidthMm", "pageHeightMm", "columns", "rows", "gapXMm", "gapYMm",
  "marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm", "definition", "updatedAt"
) VALUES
  ('label-template-a4-70x37-v1', 'a4_70x37', 1, 'A4 sheet · 70 × 37 mm', '["product","inventory_lot","display_sample"]', 'sheet', 70, 37, 210, 297, 3, 7, 0, 0, 19, 0, 19, 0, '{"showQr":true,"showHumanCode":true}', CURRENT_TIMESTAMP),
  ('label-template-thermal-100x50-v1', 'thermal_100x50', 1, 'Thermal · 100 × 50 mm', '["product","inventory_lot","display_sample"]', 'thermal', 100, 50, 100, 50, 1, 1, 0, 0, 0, 0, 0, 0, '{"showQr":true,"showHumanCode":true}', CURRENT_TIMESTAMP),
  ('label-template-thermal-50x30-v1', 'thermal_50x30', 1, 'Thermal · 50 × 30 mm', '["product","inventory_lot","display_sample"]', 'thermal', 50, 30, 50, 30, 1, 1, 0, 0, 0, 0, 0, 0, '{"showQr":true,"compact":true}', CURRENT_TIMESTAMP);

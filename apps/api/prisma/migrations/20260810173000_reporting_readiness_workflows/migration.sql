ALTER TABLE "QuoteLine"
  ADD COLUMN "costSnapshot" DOUBLE PRECISION,
  ADD COLUMN "costSnapshotSource" TEXT,
  ADD COLUMN "costSnapshotAt" TIMESTAMP(3);

ALTER TABLE "SalesOrderLine"
  ADD COLUMN "costSnapshot" DOUBLE PRECISION,
  ADD COLUMN "costSnapshotSource" TEXT,
  ADD COLUMN "costSnapshotAt" TIMESTAMP(3);

ALTER TABLE "SalesInvoiceLine"
  ADD COLUMN "costSnapshot" DOUBLE PRECISION,
  ADD COLUMN "costSnapshotSource" TEXT,
  ADD COLUMN "costSnapshotAt" TIMESTAMP(3);

CREATE TABLE "ReportingTarget" (
  "id" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "metricKey" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "scopeType" TEXT NOT NULL DEFAULT 'company',
  "scopeId" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "supersededById" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "voidReason" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportingTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportingTarget_targetKey_version_key" ON "ReportingTarget"("targetKey", "version");
CREATE INDEX "ReportingTarget_metricKey_periodStart_status_idx" ON "ReportingTarget"("metricKey", "periodStart", "status");
CREATE INDEX "ReportingTarget_scopeType_scopeId_periodStart_idx" ON "ReportingTarget"("scopeType", "scopeId", "periodStart");
CREATE INDEX "ReportingTarget_status_updatedAt_idx" ON "ReportingTarget"("status", "updatedAt" DESC);

CREATE TABLE "ReportPreset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sharedRole" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportPreset_ownerId_reportId_name_key" ON "ReportPreset"("ownerId", "reportId", "name");
CREATE INDEX "ReportPreset_ownerId_reportId_updatedAt_idx" ON "ReportPreset"("ownerId", "reportId", "updatedAt" DESC);
CREATE INDEX "ReportPreset_sharedRole_reportId_idx" ON "ReportPreset"("sharedRole", "reportId");

ALTER TABLE "ReportPreset" ADD CONSTRAINT "ReportPreset_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

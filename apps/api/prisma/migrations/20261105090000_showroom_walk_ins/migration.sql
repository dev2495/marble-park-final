-- Walk-in check-ins from the showroom scan poster, and the products each visitor scanned.
CREATE TABLE "ShowroomVisit" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mobile" TEXT NOT NULL,
  "city" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "customerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "handledBy" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShowroomVisit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShowroomVisit_token_key" ON "ShowroomVisit"("token");
CREATE INDEX "ShowroomVisit_createdAt_idx" ON "ShowroomVisit"("createdAt" DESC);
CREATE INDEX "ShowroomVisit_mobile_idx" ON "ShowroomVisit"("mobile");
CREATE INDEX "ShowroomVisit_status_createdAt_idx" ON "ShowroomVisit"("status", "createdAt" DESC);

CREATE TABLE "ShowroomVisitScan" (
  "id" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "scanCount" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShowroomVisitScan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShowroomVisitScan_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "ShowroomVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ShowroomVisitScan_visitId_productId_key" ON "ShowroomVisitScan"("visitId", "productId");

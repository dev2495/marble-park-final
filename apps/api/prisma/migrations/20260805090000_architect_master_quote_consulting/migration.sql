-- Architect master for consulting architects/firms selectable on quotes.
CREATE TABLE "Architect" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "firmName" TEXT,
    "city" TEXT,
    "address" TEXT,
    "registrationNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Architect_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Architect_name_idx" ON "Architect"("name");
CREATE INDEX "Architect_status_idx" ON "Architect"("status");
CREATE INDEX "Architect_firmName_idx" ON "Architect"("firmName");
CREATE INDEX "Architect_city_idx" ON "Architect"("city");

-- Per-quote consulting architect (FK + denormalized name for PDF/history).
ALTER TABLE "Quote" ADD COLUMN "architectId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "architectName" TEXT;

CREATE INDEX "Quote_architectId_idx" ON "Quote"("architectId");
CREATE INDEX "Quote_architectName_idx" ON "Quote"("architectName");

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_architectId_fkey" FOREIGN KEY ("architectId") REFERENCES "Architect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

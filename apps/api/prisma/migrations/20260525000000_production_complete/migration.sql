-- Production-readiness migration: payments, communications, returns,
-- sales targets, vendor POs, portal tokens, hashed session tokens, and
-- additional session metadata. All statements idempotent so the migration
-- can re-run after manual surgery without exploding.

-- ---------------------------------------------------------------------------
-- Session hardening: optional hash column + audit metadata.
-- ---------------------------------------------------------------------------
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");

-- ---------------------------------------------------------------------------
-- Payment recorded against a SalesOrder.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Payment" (
  "id"           TEXT PRIMARY KEY,
  "salesOrderId" TEXT NOT NULL,
  "customerId"   TEXT,
  "amount"       DOUBLE PRECISION NOT NULL,
  "mode"         TEXT NOT NULL,
  "reference"    TEXT,
  "paidAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"        TEXT,
  "recordedBy"   TEXT NOT NULL,
  "direction"    TEXT NOT NULL DEFAULT 'incoming',
  "metadata"     JSONB NOT NULL DEFAULT '{}',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Payment_salesOrderId_idx" ON "Payment"("salesOrderId");
CREATE INDEX IF NOT EXISTS "Payment_customerId_idx" ON "Payment"("customerId");
CREATE INDEX IF NOT EXISTS "Payment_mode_idx" ON "Payment"("mode");
CREATE INDEX IF NOT EXISTS "Payment_paidAt_idx" ON "Payment"("paidAt" DESC);

-- ---------------------------------------------------------------------------
-- Communication log for customers/leads.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Communication" (
  "id"          TEXT PRIMARY KEY,
  "customerId"  TEXT,
  "leadId"      TEXT,
  "type"        TEXT NOT NULL,
  "direction"   TEXT NOT NULL DEFAULT 'outbound',
  "summary"     TEXT NOT NULL,
  "body"        TEXT,
  "occurredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy"  TEXT NOT NULL,
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "metadata"    JSONB NOT NULL DEFAULT '{}',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Communication_customerId_occurredAt_idx" ON "Communication"("customerId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "Communication_leadId_occurredAt_idx" ON "Communication"("leadId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "Communication_type_idx" ON "Communication"("type");

-- ---------------------------------------------------------------------------
-- Returns / refunds.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ReturnRecord" (
  "id"               TEXT PRIMARY KEY,
  "returnNumber"     TEXT NOT NULL,
  "salesOrderId"     TEXT,
  "challanId"        TEXT,
  "customerId"       TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "reason"           TEXT NOT NULL,
  "reasonCategory"   TEXT,
  "refundAmount"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "refundPaymentId"  TEXT,
  "lines"            JSONB NOT NULL DEFAULT '[]',
  "notes"            TEXT,
  "recordedBy"       TEXT NOT NULL,
  "receivedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReturnRecord_returnNumber_key" ON "ReturnRecord"("returnNumber");
CREATE INDEX IF NOT EXISTS "ReturnRecord_salesOrderId_idx" ON "ReturnRecord"("salesOrderId");
CREATE INDEX IF NOT EXISTS "ReturnRecord_challanId_idx" ON "ReturnRecord"("challanId");
CREATE INDEX IF NOT EXISTS "ReturnRecord_customerId_idx" ON "ReturnRecord"("customerId");
CREATE INDEX IF NOT EXISTS "ReturnRecord_status_idx" ON "ReturnRecord"("status");
CREATE INDEX IF NOT EXISTS "ReturnRecord_createdAt_idx" ON "ReturnRecord"("createdAt" DESC);

-- ---------------------------------------------------------------------------
-- Per-user monthly sales target.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SalesTarget" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "month"     TEXT NOT NULL,
  "amount"    DOUBLE PRECISION NOT NULL,
  "notes"     TEXT,
  "setBy"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesTarget_userId_month_key" ON "SalesTarget"("userId", "month");
CREATE INDEX IF NOT EXISTS "SalesTarget_month_idx" ON "SalesTarget"("month");

-- ---------------------------------------------------------------------------
-- Customer-portal magic-link token.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PortalToken" (
  "id"         TEXT PRIMARY KEY,
  "token"      TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "scope"      TEXT NOT NULL DEFAULT 'read',
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "revokedAt"  TIMESTAMP(3),
  "createdBy"  TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PortalToken_token_key" ON "PortalToken"("token");
CREATE INDEX IF NOT EXISTS "PortalToken_customerId_idx" ON "PortalToken"("customerId");
CREATE INDEX IF NOT EXISTS "PortalToken_expiresAt_idx" ON "PortalToken"("expiresAt");

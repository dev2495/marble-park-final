ALTER TABLE "GoodsReceiptNote" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "GoodsReceiptNote_idempotencyKey_key" ON "GoodsReceiptNote"("idempotencyKey");

ALTER TABLE "ReturnOrder" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "ReturnOrder_idempotencyKey_key" ON "ReturnOrder"("idempotencyKey");

CREATE UNIQUE INDEX "DeliveryProof_challanId_key" ON "DeliveryProof"("challanId");

CREATE TABLE "CreditNote" (
  "id" TEXT NOT NULL,
  "creditNoteNumber" TEXT NOT NULL,
  "returnOrderId" TEXT NOT NULL,
  "salesOrderId" TEXT,
  "customerId" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "refundMode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'issued',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreditNote_creditNoteNumber_key" ON "CreditNote"("creditNoteNumber");
CREATE UNIQUE INDEX "CreditNote_returnOrderId_key" ON "CreditNote"("returnOrderId");
CREATE INDEX "CreditNote_salesOrderId_idx" ON "CreditNote"("salesOrderId");
CREATE INDEX "CreditNote_customerId_idx" ON "CreditNote"("customerId");
CREATE INDEX "CreditNote_status_idx" ON "CreditNote"("status");
CREATE INDEX "CreditNote_issuedAt_idx" ON "CreditNote"("issuedAt" DESC);

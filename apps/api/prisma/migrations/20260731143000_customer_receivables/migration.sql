-- Customer accounts are an append-only commercial ledger. They coexist with
-- the old PaymentReceipt rows so existing order history remains intact while
-- all new activity uses invoices, payments and allocations.
CREATE TABLE "CustomerCreditProfile" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "creditLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "defaultPaymentTerms" TEXT NOT NULL DEFAULT '',
  "creditHold" BOOLEAN NOT NULL DEFAULT false,
  "holdReason" TEXT NOT NULL DEFAULT '',
  "collectionOwnerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerCreditProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerCreditProfile_customerId_key" ON "CustomerCreditProfile"("customerId");
CREATE INDEX "CustomerCreditProfile_creditHold_idx" ON "CustomerCreditProfile"("creditHold");
CREATE INDEX "CustomerCreditProfile_collectionOwnerId_idx" ON "CustomerCreditProfile"("collectionOwnerId");

CREATE TABLE "SalesInvoice" (
  "id" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "salesOrderId" TEXT NOT NULL,
  "quoteId" TEXT,
  "customerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" TIMESTAMP(3),
  "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "openAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "paymentTerms" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "SalesInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesInvoice_invoiceNumber_key" ON "SalesInvoice"("invoiceNumber");
CREATE UNIQUE INDEX "SalesInvoice_idempotencyKey_key" ON "SalesInvoice"("idempotencyKey");
CREATE INDEX "SalesInvoice_salesOrderId_idx" ON "SalesInvoice"("salesOrderId");
CREATE INDEX "SalesInvoice_customerId_status_idx" ON "SalesInvoice"("customerId", "status");
CREATE INDEX "SalesInvoice_dueDate_idx" ON "SalesInvoice"("dueDate");
CREATE INDEX "SalesInvoice_issueDate_idx" ON "SalesInvoice"("issueDate" DESC);

CREATE TABLE "SalesInvoiceLine" (
  "id" TEXT NOT NULL,
  "salesInvoiceId" TEXT NOT NULL,
  "dispatchLineId" TEXT NOT NULL,
  "salesOrderLineId" TEXT,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT NOT NULL DEFAULT '',
  "finish" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'PC',
  "quantity" INTEGER NOT NULL,
  "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "grossLineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "SalesInvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesInvoiceLine_dispatchLineId_key" ON "SalesInvoiceLine"("dispatchLineId");
CREATE INDEX "SalesInvoiceLine_salesInvoiceId_idx" ON "SalesInvoiceLine"("salesInvoiceId");
CREATE INDEX "SalesInvoiceLine_salesOrderLineId_idx" ON "SalesInvoiceLine"("salesOrderLineId");
CREATE INDEX "SalesInvoiceLine_productId_idx" ON "SalesInvoiceLine"("productId");

CREATE TABLE "CustomerPayment" (
  "id" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "legacyReceiptId" TEXT,
  "customerId" TEXT NOT NULL,
  "salesOrderId" TEXT,
  "paymentMode" TEXT NOT NULL,
  "moneyAccount" TEXT NOT NULL DEFAULT 'undeposited',
  "amount" DOUBLE PRECISION NOT NULL,
  "unappliedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valueDate" TIMESTAMP(3),
  "reference" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "attachmentUrls" JSONB NOT NULL DEFAULT '[]',
  "createdBy" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerPayment_receiptNumber_key" ON "CustomerPayment"("receiptNumber");
CREATE UNIQUE INDEX "CustomerPayment_idempotencyKey_key" ON "CustomerPayment"("idempotencyKey");
CREATE UNIQUE INDEX "CustomerPayment_legacyReceiptId_key" ON "CustomerPayment"("legacyReceiptId");
CREATE INDEX "CustomerPayment_customerId_status_idx" ON "CustomerPayment"("customerId", "status");
CREATE INDEX "CustomerPayment_salesOrderId_idx" ON "CustomerPayment"("salesOrderId");
CREATE INDEX "CustomerPayment_paymentMode_idx" ON "CustomerPayment"("paymentMode");
CREATE INDEX "CustomerPayment_receivedAt_idx" ON "CustomerPayment"("receivedAt" DESC);

CREATE TABLE "CustomerAllocation" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "salesInvoiceId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "CustomerAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerAllocation_sourceType_sourceId_salesInvoiceId_key" ON "CustomerAllocation"("sourceType", "sourceId", "salesInvoiceId");
CREATE INDEX "CustomerAllocation_customerId_status_idx" ON "CustomerAllocation"("customerId", "status");
CREATE INDEX "CustomerAllocation_salesInvoiceId_status_idx" ON "CustomerAllocation"("salesInvoiceId", "status");
CREATE INDEX "CustomerAllocation_sourceType_sourceId_status_idx" ON "CustomerAllocation"("sourceType", "sourceId", "status");

CREATE TABLE "CustomerLedgerEntry" (
  "id" TEXT NOT NULL,
  "entryNumber" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "narration" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "CustomerLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerLedgerEntry_entryNumber_key" ON "CustomerLedgerEntry"("entryNumber");
CREATE UNIQUE INDEX "CustomerLedgerEntry_sourceKey_key" ON "CustomerLedgerEntry"("sourceKey");
CREATE INDEX "CustomerLedgerEntry_customerId_effectiveAt_idx" ON "CustomerLedgerEntry"("customerId", "effectiveAt" DESC);
CREATE INDEX "CustomerLedgerEntry_sourceType_sourceId_idx" ON "CustomerLedgerEntry"("sourceType", "sourceId");

CREATE TABLE "CollectionTask" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "salesInvoiceId" TEXT,
  "ownerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "note" TEXT NOT NULL DEFAULT '',
  "outcome" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "CollectionTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CollectionTask_customerId_status_idx" ON "CollectionTask"("customerId", "status");
CREATE INDEX "CollectionTask_salesInvoiceId_idx" ON "CollectionTask"("salesInvoiceId");
CREATE INDEX "CollectionTask_ownerId_status_idx" ON "CollectionTask"("ownerId", "status");
CREATE INDEX "CollectionTask_dueAt_idx" ON "CollectionTask"("dueAt");

ALTER TABLE "SalesInvoiceLine"
  ADD CONSTRAINT "SalesInvoiceLine_salesInvoiceId_fkey"
  FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerAllocation"
  ADD CONSTRAINT "CustomerAllocation_salesInvoiceId_fkey"
  FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve historical posted receipts as unapplied customer advances. These
-- are intentionally not allocated automatically because historical invoices
-- do not exist in the old model and a fabricated allocation would be unsafe.
INSERT INTO "CustomerPayment" (
  "id", "receiptNumber", "legacyReceiptId", "customerId", "salesOrderId",
  "paymentMode", "moneyAccount", "amount", "unappliedAmount", "status",
  "receivedAt", "valueDate", "reference", "notes", "attachmentUrls",
  "createdBy", "postedAt", "createdAt", "updatedAt", "metadata"
)
SELECT
  'legacy-payment-' || p."id", p."receiptNumber", p."id", p."customerId", p."salesOrderId",
  p."paymentMode", CASE WHEN lower(p."paymentMode") = 'cash' THEN 'cash_drawer' ELSE 'bank' END,
  p."amount", p."amount", 'posted', p."receivedAt", p."receivedAt", p."reference", p."notes", '[]'::jsonb,
  p."createdBy", p."receivedAt", p."createdAt", p."updatedAt", jsonb_build_object('legacyReceiptNumber', p."receiptNumber")
FROM "PaymentReceipt" p
WHERE p."status" = 'posted' AND p."amount" > 0
ON CONFLICT ("legacyReceiptId") DO NOTHING;

INSERT INTO "CustomerLedgerEntry" (
  "id", "entryNumber", "customerId", "sourceType", "sourceId", "sourceKey",
  "effectiveAt", "debit", "credit", "narration", "createdBy", "createdAt", "metadata"
)
SELECT
  'legacy-ledger-' || p."id", 'LEDGER/LEGACY/' || p."id", p."customerId", 'CustomerPayment',
  cp."id", 'legacy-receipt:' || p."id", p."receivedAt", 0, p."amount",
  'Migrated receipt ' || p."receiptNumber", p."createdBy", p."createdAt", jsonb_build_object('legacyReceiptNumber', p."receiptNumber")
FROM "PaymentReceipt" p
JOIN "CustomerPayment" cp ON cp."legacyReceiptId" = p."id"
WHERE p."status" = 'posted' AND p."amount" > 0
ON CONFLICT ("sourceKey") DO NOTHING;

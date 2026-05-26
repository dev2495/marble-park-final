-- Production hardening records for document-driven stock/order truth.

CREATE TABLE IF NOT EXISTS "QuoteLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "quoteId" TEXT NOT NULL,
  "lineKey" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "finish" TEXT,
  "area" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'PC',
  "quantity" INTEGER NOT NULL,
  "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'quoted',
  "isTileSpecial" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteLine_quoteId_lineKey_key" ON "QuoteLine"("quoteId", "lineKey");
CREATE INDEX IF NOT EXISTS "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");
CREATE INDEX IF NOT EXISTS "QuoteLine_productId_idx" ON "QuoteLine"("productId");
CREATE INDEX IF NOT EXISTS "QuoteLine_status_idx" ON "QuoteLine"("status");
CREATE INDEX IF NOT EXISTS "QuoteLine_createdAt_idx" ON "QuoteLine"("createdAt" DESC);

CREATE TABLE IF NOT EXISTS "SalesOrderLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "salesOrderId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "quoteLineId" TEXT,
  "lineKey" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "finish" TEXT,
  "area" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'PC',
  "orderedQuantity" INTEGER NOT NULL,
  "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
  "backorderedQuantity" INTEGER NOT NULL DEFAULT 0,
  "allocatedQuantity" INTEGER NOT NULL DEFAULT 0,
  "dispatchedQuantity" INTEGER NOT NULL DEFAULT 0,
  "deliveredQuantity" INTEGER NOT NULL DEFAULT 0,
  "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
  "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "isTileSpecial" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "SalesOrderLine_salesOrderId_lineKey_key" ON "SalesOrderLine"("salesOrderId", "lineKey");
CREATE INDEX IF NOT EXISTS "SalesOrderLine_salesOrderId_idx" ON "SalesOrderLine"("salesOrderId");
CREATE INDEX IF NOT EXISTS "SalesOrderLine_quoteId_idx" ON "SalesOrderLine"("quoteId");
CREATE INDEX IF NOT EXISTS "SalesOrderLine_productId_idx" ON "SalesOrderLine"("productId");
CREATE INDEX IF NOT EXISTS "SalesOrderLine_status_idx" ON "SalesOrderLine"("status");
CREATE INDEX IF NOT EXISTS "SalesOrderLine_createdAt_idx" ON "SalesOrderLine"("createdAt" DESC);

CREATE TABLE IF NOT EXISTS "DocumentJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "url" TEXT,
  "storageKey" TEXT,
  "contentType" TEXT NOT NULL DEFAULT 'application/pdf',
  "error" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "generatedBy" TEXT,
  "generatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentJob_entityType_entityId_documentType_key" ON "DocumentJob"("entityType", "entityId", "documentType");
CREATE INDEX IF NOT EXISTS "DocumentJob_entity_idx" ON "DocumentJob"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "DocumentJob_documentType_idx" ON "DocumentJob"("documentType");
CREATE INDEX IF NOT EXISTS "DocumentJob_status_idx" ON "DocumentJob"("status");
CREATE INDEX IF NOT EXISTS "DocumentJob_createdAt_idx" ON "DocumentJob"("createdAt" DESC);

CREATE TABLE IF NOT EXISTS "PaymentReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "receiptNumber" TEXT NOT NULL UNIQUE,
  "salesOrderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "paymentMode" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "reference" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "PaymentReceipt_salesOrderId_idx" ON "PaymentReceipt"("salesOrderId");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_customerId_idx" ON "PaymentReceipt"("customerId");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_paymentMode_idx" ON "PaymentReceipt"("paymentMode");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_status_idx" ON "PaymentReceipt"("status");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_receivedAt_idx" ON "PaymentReceipt"("receivedAt" DESC);

CREATE TABLE IF NOT EXISTS "SequenceCounter" (
  "scope" TEXT NOT NULL PRIMARY KEY,
  "value" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "StockLocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'showroom',
  "status" TEXT NOT NULL DEFAULT 'active',
  "address" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "StockLocation_status_idx" ON "StockLocation"("status");
CREATE INDEX IF NOT EXISTS "StockLocation_type_idx" ON "StockLocation"("type");

CREATE TABLE IF NOT EXISTS "StockBalanceByLocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "onHand" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "damaged" INTEGER NOT NULL DEFAULT 0,
  "hold" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockBalanceByLocation_productId_locationId_key" ON "StockBalanceByLocation"("productId", "locationId");
CREATE INDEX IF NOT EXISTS "StockBalanceByLocation_productId_idx" ON "StockBalanceByLocation"("productId");
CREATE INDEX IF NOT EXISTS "StockBalanceByLocation_locationId_idx" ON "StockBalanceByLocation"("locationId");

CREATE TABLE IF NOT EXISTS "StockLedgerEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT,
  "locationId" TEXT,
  "type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "direction" TEXT NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "sourceDocumentNo" TEXT,
  "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "StockLedgerEntry_productId_idx" ON "StockLedgerEntry"("productId");
CREATE INDEX IF NOT EXISTS "StockLedgerEntry_locationId_idx" ON "StockLedgerEntry"("locationId");
CREATE INDEX IF NOT EXISTS "StockLedgerEntry_type_idx" ON "StockLedgerEntry"("type");
CREATE INDEX IF NOT EXISTS "StockLedgerEntry_reference_idx" ON "StockLedgerEntry"("referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "StockLedgerEntry_createdAt_idx" ON "StockLedgerEntry"("createdAt" DESC);

CREATE TABLE IF NOT EXISTS "StockCountSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "countNumber" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "scope" TEXT NOT NULL DEFAULT 'all',
  "locationId" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "StockCountSession_status_idx" ON "StockCountSession"("status");
CREATE INDEX IF NOT EXISTS "StockCountSession_locationId_idx" ON "StockCountSession"("locationId");
CREATE INDEX IF NOT EXISTS "StockCountSession_startedAt_idx" ON "StockCountSession"("startedAt" DESC);

CREATE TABLE IF NOT EXISTS "StockCountLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "stockCountId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "expectedQuantity" INTEGER NOT NULL,
  "countedQuantity" INTEGER NOT NULL,
  "variance" INTEGER NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'counted',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockCountLine_stockCountId_productId_key" ON "StockCountLine"("stockCountId", "productId");
CREATE INDEX IF NOT EXISTS "StockCountLine_stockCountId_idx" ON "StockCountLine"("stockCountId");
CREATE INDEX IF NOT EXISTS "StockCountLine_productId_idx" ON "StockCountLine"("productId");
CREATE INDEX IF NOT EXISTS "StockCountLine_status_idx" ON "StockCountLine"("status");

CREATE TABLE IF NOT EXISTS "StockAdjustmentApproval" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reason" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "referenceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "StockAdjustmentApproval_productId_idx" ON "StockAdjustmentApproval"("productId");
CREATE INDEX IF NOT EXISTS "StockAdjustmentApproval_status_idx" ON "StockAdjustmentApproval"("status");
CREATE INDEX IF NOT EXISTS "StockAdjustmentApproval_createdAt_idx" ON "StockAdjustmentApproval"("createdAt" DESC);

CREATE TABLE IF NOT EXISTS "ProductVendor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "vendorSku" TEXT,
  "vendorName" TEXT NOT NULL,
  "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
  "minOrderQty" INTEGER NOT NULL DEFAULT 1,
  "packMultiple" INTEGER NOT NULL DEFAULT 1,
  "lastCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "preferred" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductVendor_productId_vendorId_key" ON "ProductVendor"("productId", "vendorId");
CREATE INDEX IF NOT EXISTS "ProductVendor_productId_idx" ON "ProductVendor"("productId");
CREATE INDEX IF NOT EXISTS "ProductVendor_vendorId_idx" ON "ProductVendor"("vendorId");
CREATE INDEX IF NOT EXISTS "ProductVendor_preferred_idx" ON "ProductVendor"("preferred");
CREATE INDEX IF NOT EXISTS "ProductVendor_status_idx" ON "ProductVendor"("status");

CREATE TABLE IF NOT EXISTS "ReorderPolicy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL UNIQUE,
  "preferredVendorId" TEXT,
  "minQuantity" INTEGER NOT NULL DEFAULT 0,
  "maxQuantity" INTEGER NOT NULL DEFAULT 0,
  "reorderPoint" INTEGER NOT NULL DEFAULT 0,
  "reorderQuantity" INTEGER NOT NULL DEFAULT 0,
  "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
  "packMultiple" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "ReorderPolicy_preferredVendorId_idx" ON "ReorderPolicy"("preferredVendorId");
CREATE INDEX IF NOT EXISTS "ReorderPolicy_status_idx" ON "ReorderPolicy"("status");

CREATE TABLE IF NOT EXISTS "DispatchPackage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dispatchJobId" TEXT NOT NULL,
  "challanId" TEXT NOT NULL,
  "packageNumber" TEXT NOT NULL,
  "boxCount" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'packed',
  "packedBy" TEXT,
  "packedAt" TIMESTAMP(3),
  "remarks" TEXT NOT NULL DEFAULT '',
  "photos" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "DispatchPackage_challanId_packageNumber_key" ON "DispatchPackage"("challanId", "packageNumber");
CREATE INDEX IF NOT EXISTS "DispatchPackage_dispatchJobId_idx" ON "DispatchPackage"("dispatchJobId");
CREATE INDEX IF NOT EXISTS "DispatchPackage_challanId_idx" ON "DispatchPackage"("challanId");
CREATE INDEX IF NOT EXISTS "DispatchPackage_status_idx" ON "DispatchPackage"("status");

CREATE TABLE IF NOT EXISTS "DispatchLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dispatchJobId" TEXT NOT NULL,
  "challanId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "dispatchKey" TEXT NOT NULL,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "orderedQuantity" INTEGER NOT NULL,
  "packedQuantity" INTEGER NOT NULL DEFAULT 0,
  "dispatchedQuantity" INTEGER NOT NULL DEFAULT 0,
  "deliveredQuantity" INTEGER NOT NULL DEFAULT 0,
  "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'packed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "DispatchLine_dispatchJobId_idx" ON "DispatchLine"("dispatchJobId");
CREATE INDEX IF NOT EXISTS "DispatchLine_challanId_idx" ON "DispatchLine"("challanId");
CREATE INDEX IF NOT EXISTS "DispatchLine_salesOrderId_idx" ON "DispatchLine"("salesOrderId");
CREATE INDEX IF NOT EXISTS "DispatchLine_salesOrderLineId_idx" ON "DispatchLine"("salesOrderLineId");
CREATE INDEX IF NOT EXISTS "DispatchLine_productId_idx" ON "DispatchLine"("productId");
CREATE INDEX IF NOT EXISTS "DispatchLine_status_idx" ON "DispatchLine"("status");

CREATE TABLE IF NOT EXISTS "Shipment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipmentNumber" TEXT NOT NULL UNIQUE,
  "dispatchJobId" TEXT NOT NULL,
  "challanId" TEXT NOT NULL,
  "transporterName" TEXT,
  "vehicleNumber" TEXT,
  "driverName" TEXT,
  "contactPhone" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "dispatchedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "Shipment_dispatchJobId_idx" ON "Shipment"("dispatchJobId");
CREATE INDEX IF NOT EXISTS "Shipment_challanId_idx" ON "Shipment"("challanId");
CREATE INDEX IF NOT EXISTS "Shipment_status_idx" ON "Shipment"("status");

CREATE TABLE IF NOT EXISTS "DeliveryProof" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipmentId" TEXT,
  "challanId" TEXT NOT NULL,
  "receivedByName" TEXT NOT NULL,
  "receivedByPhone" TEXT,
  "proofType" TEXT NOT NULL DEFAULT 'manual',
  "proofUrl" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "DeliveryProof_shipmentId_idx" ON "DeliveryProof"("shipmentId");
CREATE INDEX IF NOT EXISTS "DeliveryProof_challanId_idx" ON "DeliveryProof"("challanId");
CREATE INDEX IF NOT EXISTS "DeliveryProof_capturedAt_idx" ON "DeliveryProof"("capturedAt" DESC);

CREATE TABLE IF NOT EXISTS "ReturnOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "returnNumber" TEXT NOT NULL UNIQUE,
  "salesOrderId" TEXT,
  "challanId" TEXT,
  "customerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "reason" TEXT NOT NULL,
  "refundMode" TEXT,
  "refundAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "receivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "ReturnOrder_salesOrderId_idx" ON "ReturnOrder"("salesOrderId");
CREATE INDEX IF NOT EXISTS "ReturnOrder_challanId_idx" ON "ReturnOrder"("challanId");
CREATE INDEX IF NOT EXISTS "ReturnOrder_customerId_idx" ON "ReturnOrder"("customerId");
CREATE INDEX IF NOT EXISTS "ReturnOrder_status_idx" ON "ReturnOrder"("status");
CREATE INDEX IF NOT EXISTS "ReturnOrder_createdAt_idx" ON "ReturnOrder"("createdAt" DESC);

CREATE TABLE IF NOT EXISTS "ReturnLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "returnOrderId" TEXT NOT NULL,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "disposition" TEXT NOT NULL DEFAULT 'inspect',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "ReturnLine_returnOrderId_idx" ON "ReturnLine"("returnOrderId");
CREATE INDEX IF NOT EXISTS "ReturnLine_productId_idx" ON "ReturnLine"("productId");
CREATE INDEX IF NOT EXISTS "ReturnLine_status_idx" ON "ReturnLine"("status");

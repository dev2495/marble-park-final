CREATE TABLE "PurchaseDemand" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'sales_order',
  "sourceLineKey" TEXT NOT NULL,
  "sourceOrderId" TEXT,
  "sourceQuoteId" TEXT,
  "sourceReservationId" TEXT,
  "customerId" TEXT,
  "ownerId" TEXT,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "finish" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'PC',
  "quantity" INTEGER NOT NULL,
  "orderedQuantity" INTEGER NOT NULL DEFAULT 0,
  "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "preferredVendorId" TEXT,
  "vendorName" TEXT,
  "expectedDate" TIMESTAMP(3),
  "notes" TEXT NOT NULL DEFAULT '',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseDemand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseDemand_sourceLineKey_key" ON "PurchaseDemand"("sourceLineKey");
CREATE INDEX "PurchaseDemand_sourceOrderId_idx" ON "PurchaseDemand"("sourceOrderId");
CREATE INDEX "PurchaseDemand_sourceQuoteId_idx" ON "PurchaseDemand"("sourceQuoteId");
CREATE INDEX "PurchaseDemand_sourceReservationId_idx" ON "PurchaseDemand"("sourceReservationId");
CREATE INDEX "PurchaseDemand_productId_idx" ON "PurchaseDemand"("productId");
CREATE INDEX "PurchaseDemand_status_idx" ON "PurchaseDemand"("status");
CREATE INDEX "PurchaseDemand_expectedDate_idx" ON "PurchaseDemand"("expectedDate");
CREATE INDEX "PurchaseDemand_createdAt_idx" ON "PurchaseDemand"("createdAt" DESC);

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "poNumber" TEXT NOT NULL,
  "vendorId" TEXT,
  "vendorName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "expectedDate" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "orderedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");
CREATE INDEX "PurchaseOrder_vendorId_idx" ON "PurchaseOrder"("vendorId");
CREATE INDEX "PurchaseOrder_vendorName_idx" ON "PurchaseOrder"("vendorName");
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");
CREATE INDEX "PurchaseOrder_expectedDate_idx" ON "PurchaseOrder"("expectedDate");
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt" DESC);

CREATE TABLE "PurchaseOrderLine" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "purchaseDemandId" TEXT,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "finish" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'PC',
  "orderedQuantity" INTEGER NOT NULL,
  "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  "cancelledQuantity" INTEGER NOT NULL DEFAULT 0,
  "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ordered',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");
CREATE INDEX "PurchaseOrderLine_purchaseDemandId_idx" ON "PurchaseOrderLine"("purchaseDemandId");
CREATE INDEX "PurchaseOrderLine_productId_idx" ON "PurchaseOrderLine"("productId");
CREATE INDEX "PurchaseOrderLine_status_idx" ON "PurchaseOrderLine"("status");

CREATE TABLE "GoodsReceiptNote" (
  "id" TEXT NOT NULL,
  "grnNumber" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "vendorId" TEXT,
  "vendorName" TEXT NOT NULL,
  "supplierChallan" TEXT,
  "supplierBill" TEXT,
  "receivedDate" TIMESTAMP(3) NOT NULL,
  "receivedBy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "notes" TEXT NOT NULL DEFAULT '',
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoodsReceiptNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoodsReceiptNote_grnNumber_key" ON "GoodsReceiptNote"("grnNumber");
CREATE INDEX "GoodsReceiptNote_purchaseOrderId_idx" ON "GoodsReceiptNote"("purchaseOrderId");
CREATE INDEX "GoodsReceiptNote_vendorName_idx" ON "GoodsReceiptNote"("vendorName");
CREATE INDEX "GoodsReceiptNote_receivedDate_idx" ON "GoodsReceiptNote"("receivedDate");
CREATE INDEX "GoodsReceiptNote_createdAt_idx" ON "GoodsReceiptNote"("createdAt" DESC);

CREATE TABLE "GoodsReceiptLine" (
  "id" TEXT NOT NULL,
  "goodsReceiptNoteId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "orderedQuantity" INTEGER NOT NULL,
  "receivedQuantity" INTEGER NOT NULL,
  "acceptedQuantity" INTEGER NOT NULL,
  "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
  "location" TEXT,
  "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GoodsReceiptLine_goodsReceiptNoteId_idx" ON "GoodsReceiptLine"("goodsReceiptNoteId");
CREATE INDEX "GoodsReceiptLine_purchaseOrderLineId_idx" ON "GoodsReceiptLine"("purchaseOrderLineId");
CREATE INDEX "GoodsReceiptLine_productId_idx" ON "GoodsReceiptLine"("productId");

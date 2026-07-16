-- DropIndex
DROP INDEX "StockCountLine_stockCountId_productId_key";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "allowLoose" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "baseUom" TEXT NOT NULL DEFAULT 'PC',
ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "coveragePerPack" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "finishId" TEXT,
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "internalCode" TEXT,
ADD COLUMN     "materialId" TEXT,
ADD COLUMN     "piecesPerPack" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "purchaseUom" TEXT NOT NULL DEFAULT 'PC',
ADD COLUMN     "salesUom" TEXT NOT NULL DEFAULT 'PC',
ADD COLUMN     "tileSizeId" TEXT,
ADD COLUMN     "trackLots" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "StockLedgerEntry" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lotId" TEXT;

-- AlterTable
ALTER TABLE "StockCountSession" ADD COLUMN     "countType" TEXT NOT NULL DEFAULT 'cycle',
ADD COLUMN     "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "frozenAt" TIMESTAMP(3),
ADD COLUMN     "periodKey" TEXT,
ADD COLUMN     "postedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StockCountLine" ADD COLUMN     "adjustmentPosted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "lotId" TEXT,
ADD COLUMN     "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "varianceValue" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StockAdjustmentApproval" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "lotId" TEXT;

-- AlterTable
ALTER TABLE "DispatchLine" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "lotId" TEXT,
ADD COLUMN     "pickLineId" TEXT;

-- AlterTable
ALTER TABLE "ReturnLine" ADD COLUMN     "acceptedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dispatchLineId" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "lotId" TEXT,
ADD COLUMN     "resellQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesOrderLineId" TEXT,
ADD COLUMN     "supplierReturnQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProductMaterial" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT 'count',
    "decimalScale" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hsnCode" TEXT,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 18,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisplaySample" (
    "id" TEXT NOT NULL,
    "sampleNumber" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "internalCode" TEXT NOT NULL,
    "locationId" TEXT,
    "displayZone" TEXT,
    "displayPosition" TEXT,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sellable" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisplaySample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "supplierBatch" TEXT,
    "qualityStatus" TEXT NOT NULL DEFAULT 'available',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "manufacturedAt" TIMESTAMP(3),
    "expiryAt" TIMESTAMP(3),
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLotBalance" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "hold" INTEGER NOT NULL DEFAULT 0,
    "available" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLotBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLotLedgerEntry" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "onHandDelta" INTEGER NOT NULL DEFAULT 0,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "damagedDelta" INTEGER NOT NULL DEFAULT 0,
    "holdDelta" INTEGER NOT NULL DEFAULT 0,
    "balanceAfter" JSONB NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "sourceDocumentNo" TEXT,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLotLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningStockSession" (
    "id" TEXT NOT NULL,
    "sessionNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "locationId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "valuationMode" TEXT NOT NULL DEFAULT 'unit_cost',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "submittedBy" TEXT,
    "approvedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningStockSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningStockLine" (
    "id" TEXT NOT NULL,
    "openingStockSessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT,
    "lotCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supplierBatch" TEXT,
    "qualityStatus" TEXT NOT NULL DEFAULT 'available',
    "rackBin" TEXT,
    "status" TEXT NOT NULL DEFAULT 'counted',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningStockLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "dispatchedBy" TEXT,
    "receivedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" TEXT NOT NULL,
    "stockTransferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "requestedQuantity" INTEGER NOT NULL,
    "dispatchedQuantity" INTEGER NOT NULL DEFAULT 0,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotReservation" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "salesOrderLineId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LotReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickList" (
    "id" TEXT NOT NULL,
    "pickNumber" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "assignedTo" TEXT,
    "createdBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickLine" (
    "id" TEXT NOT NULL,
    "pickListId" TEXT NOT NULL,
    "salesOrderLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "requestedQuantity" INTEGER NOT NULL,
    "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
    "packedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pickedBy" TEXT,
    "pickedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalLabelJob" (
    "id" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requestedBy" TEXT NOT NULL,
    "completedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalLabelJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalLabelInstance" (
    "id" TEXT NOT NULL,
    "labelCode" TEXT NOT NULL,
    "labelJobId" TEXT NOT NULL,
    "productId" TEXT,
    "lotId" TEXT,
    "displaySampleId" TEXT,
    "unitNumber" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalLabelInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalScanEvent" (
    "id" TEXT NOT NULL,
    "labelInstanceId" TEXT,
    "labelCode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "locationId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "result" TEXT NOT NULL DEFAULT 'success',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalScanEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryPeriodClose" (
    "id" TEXT NOT NULL,
    "closeNumber" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "countSessionId" TEXT,
    "totalQuantity" INTEGER NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "varianceQuantity" INTEGER NOT NULL DEFAULT 0,
    "varianceValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "closedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryPeriodClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryPeriodSnapshot" (
    "id" TEXT NOT NULL,
    "inventoryPeriodCloseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT,
    "locationId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL,
    "damaged" INTEGER NOT NULL,
    "hold" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stockValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryPeriodSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductMaterial_name_key" ON "ProductMaterial"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMaterial_code_key" ON "ProductMaterial"("code");

-- CreateIndex
CREATE INDEX "ProductMaterial_status_idx" ON "ProductMaterial"("status");

-- CreateIndex
CREATE INDEX "ProductMaterial_sortOrder_idx" ON "ProductMaterial"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_code_key" ON "UnitOfMeasure"("code");

-- CreateIndex
CREATE INDEX "UnitOfMeasure_dimension_idx" ON "UnitOfMeasure"("dimension");

-- CreateIndex
CREATE INDEX "UnitOfMeasure_status_idx" ON "UnitOfMeasure"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_code_key" ON "TaxCode"("code");

-- CreateIndex
CREATE INDEX "TaxCode_hsnCode_idx" ON "TaxCode"("hsnCode");

-- CreateIndex
CREATE INDEX "TaxCode_status_idx" ON "TaxCode"("status");

-- CreateIndex
CREATE INDEX "ProductAlias_productId_status_idx" ON "ProductAlias"("productId", "status");

-- CreateIndex
CREATE INDEX "ProductAlias_normalizedValue_idx" ON "ProductAlias"("normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_type_normalizedValue_key" ON "ProductAlias"("type", "normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "DisplaySample_sampleNumber_key" ON "DisplaySample"("sampleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DisplaySample_internalCode_key" ON "DisplaySample"("internalCode");

-- CreateIndex
CREATE INDEX "DisplaySample_productId_idx" ON "DisplaySample"("productId");

-- CreateIndex
CREATE INDEX "DisplaySample_locationId_idx" ON "DisplaySample"("locationId");

-- CreateIndex
CREATE INDEX "DisplaySample_status_idx" ON "DisplaySample"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_lotNumber_key" ON "InventoryLot"("lotNumber");

-- CreateIndex
CREATE INDEX "InventoryLot_productId_status_idx" ON "InventoryLot"("productId", "status");

-- CreateIndex
CREATE INDEX "InventoryLot_supplierBatch_idx" ON "InventoryLot"("supplierBatch");

-- CreateIndex
CREATE INDEX "InventoryLot_receivedAt_idx" ON "InventoryLot"("receivedAt" DESC);

-- CreateIndex
CREATE INDEX "InventoryLot_qualityStatus_idx" ON "InventoryLot"("qualityStatus");

-- Link each inward line to the exact universal inventory lot it created.
ALTER TABLE "GoodsReceiptLine" ADD COLUMN "lotId" TEXT;
CREATE INDEX "GoodsReceiptLine_lotId_idx" ON "GoodsReceiptLine"("lotId");
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_sourceType_sourceId_sourceLineId_key" ON "InventoryLot"("sourceType", "sourceId", "sourceLineId");

-- CreateIndex
CREATE INDEX "InventoryLotBalance_locationId_available_idx" ON "InventoryLotBalance"("locationId", "available");

-- CreateIndex
CREATE INDEX "InventoryLotBalance_lotId_idx" ON "InventoryLotBalance"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLotBalance_lotId_locationId_key" ON "InventoryLotBalance"("lotId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLotLedgerEntry_idempotencyKey_key" ON "InventoryLotLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryLotLedgerEntry_productId_createdAt_idx" ON "InventoryLotLedgerEntry"("productId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "InventoryLotLedgerEntry_lotId_createdAt_idx" ON "InventoryLotLedgerEntry"("lotId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "InventoryLotLedgerEntry_locationId_createdAt_idx" ON "InventoryLotLedgerEntry"("locationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "InventoryLotLedgerEntry_referenceType_referenceId_idx" ON "InventoryLotLedgerEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "InventoryLotLedgerEntry_type_idx" ON "InventoryLotLedgerEntry"("type");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningStockSession_sessionNumber_key" ON "OpeningStockSession"("sessionNumber");

-- CreateIndex
CREATE INDEX "OpeningStockSession_locationId_idx" ON "OpeningStockSession"("locationId");

-- CreateIndex
CREATE INDEX "OpeningStockSession_status_idx" ON "OpeningStockSession"("status");

-- CreateIndex
CREATE INDEX "OpeningStockSession_effectiveAt_idx" ON "OpeningStockSession"("effectiveAt" DESC);

-- CreateIndex
CREATE INDEX "OpeningStockSession_fiscalYear_idx" ON "OpeningStockSession"("fiscalYear");

-- CreateIndex
CREATE INDEX "OpeningStockLine_openingStockSessionId_idx" ON "OpeningStockLine"("openingStockSessionId");

-- CreateIndex
CREATE INDEX "OpeningStockLine_productId_idx" ON "OpeningStockLine"("productId");

-- CreateIndex
CREATE INDEX "OpeningStockLine_lotId_idx" ON "OpeningStockLine"("lotId");

-- CreateIndex
CREATE INDEX "OpeningStockLine_status_idx" ON "OpeningStockLine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_transferNumber_key" ON "StockTransfer"("transferNumber");

-- CreateIndex
CREATE INDEX "StockTransfer_sourceLocationId_status_idx" ON "StockTransfer"("sourceLocationId", "status");

-- CreateIndex
CREATE INDEX "StockTransfer_destinationLocationId_status_idx" ON "StockTransfer"("destinationLocationId", "status");

-- CreateIndex
CREATE INDEX "StockTransfer_requestedAt_idx" ON "StockTransfer"("requestedAt" DESC);

-- CreateIndex
CREATE INDEX "StockTransferLine_productId_idx" ON "StockTransferLine"("productId");

-- CreateIndex
CREATE INDEX "StockTransferLine_lotId_idx" ON "StockTransferLine"("lotId");

-- CreateIndex
CREATE INDEX "StockTransferLine_status_idx" ON "StockTransferLine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferLine_stockTransferId_lotId_key" ON "StockTransferLine"("stockTransferId", "lotId");

-- CreateIndex
CREATE INDEX "LotReservation_salesOrderLineId_status_idx" ON "LotReservation"("salesOrderLineId", "status");

-- CreateIndex
CREATE INDEX "LotReservation_lotId_locationId_status_idx" ON "LotReservation"("lotId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LotReservation_reservationId_lotId_locationId_key" ON "LotReservation"("reservationId", "lotId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "PickList_pickNumber_key" ON "PickList"("pickNumber");

-- CreateIndex
CREATE INDEX "PickList_salesOrderId_status_idx" ON "PickList"("salesOrderId", "status");

-- CreateIndex
CREATE INDEX "PickList_locationId_status_idx" ON "PickList"("locationId", "status");

-- CreateIndex
CREATE INDEX "PickList_createdAt_idx" ON "PickList"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "PickLine_salesOrderLineId_idx" ON "PickLine"("salesOrderLineId");

-- CreateIndex
CREATE INDEX "PickLine_lotId_locationId_idx" ON "PickLine"("lotId", "locationId");

-- CreateIndex
CREATE INDEX "PickLine_status_idx" ON "PickLine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PickLine_pickListId_salesOrderLineId_lotId_locationId_key" ON "PickLine"("pickListId", "salesOrderLineId", "lotId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalLabelJob_jobNumber_key" ON "InternalLabelJob"("jobNumber");

-- CreateIndex
CREATE INDEX "InternalLabelJob_sourceType_sourceId_idx" ON "InternalLabelJob"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "InternalLabelJob_status_requestedAt_idx" ON "InternalLabelJob"("status", "requestedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "InternalLabelInstance_labelCode_key" ON "InternalLabelInstance"("labelCode");

-- CreateIndex
CREATE INDEX "InternalLabelInstance_labelJobId_idx" ON "InternalLabelInstance"("labelJobId");

-- CreateIndex
CREATE INDEX "InternalLabelInstance_productId_idx" ON "InternalLabelInstance"("productId");

-- CreateIndex
CREATE INDEX "InternalLabelInstance_lotId_idx" ON "InternalLabelInstance"("lotId");

-- CreateIndex
CREATE INDEX "InternalLabelInstance_displaySampleId_idx" ON "InternalLabelInstance"("displaySampleId");

-- CreateIndex
CREATE INDEX "InternalLabelInstance_status_idx" ON "InternalLabelInstance"("status");

-- CreateIndex
CREATE INDEX "InternalScanEvent_labelCode_createdAt_idx" ON "InternalScanEvent"("labelCode", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "InternalScanEvent_actorUserId_createdAt_idx" ON "InternalScanEvent"("actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "InternalScanEvent_entityType_entityId_idx" ON "InternalScanEvent"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPeriodClose_closeNumber_key" ON "InventoryPeriodClose"("closeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPeriodClose_periodKey_key" ON "InventoryPeriodClose"("periodKey");

-- CreateIndex
CREATE INDEX "InventoryPeriodClose_periodType_idx" ON "InventoryPeriodClose"("periodType");

-- CreateIndex
CREATE INDEX "InventoryPeriodClose_status_idx" ON "InventoryPeriodClose"("status");

-- CreateIndex
CREATE INDEX "InventoryPeriodClose_effectiveAt_idx" ON "InventoryPeriodClose"("effectiveAt" DESC);

-- CreateIndex
CREATE INDEX "InventoryPeriodSnapshot_productId_idx" ON "InventoryPeriodSnapshot"("productId");

-- CreateIndex
CREATE INDEX "InventoryPeriodSnapshot_lotId_idx" ON "InventoryPeriodSnapshot"("lotId");

-- CreateIndex
CREATE INDEX "InventoryPeriodSnapshot_locationId_idx" ON "InventoryPeriodSnapshot"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPeriodSnapshot_inventoryPeriodCloseId_productId_lo_key" ON "InventoryPeriodSnapshot"("inventoryPeriodCloseId", "productId", "lotId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_internalCode_key" ON "Product"("internalCode");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_finishId_idx" ON "Product"("finishId");

-- CreateIndex
CREATE INDEX "Product_materialId_idx" ON "Product"("materialId");

-- CreateIndex
CREATE INDEX "Product_tileSizeId_idx" ON "Product"("tileSizeId");

-- CreateIndex
CREATE INDEX "Reservation_locationId_status_idx" ON "Reservation"("locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockLedgerEntry_idempotencyKey_key" ON "StockLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_lotId_idx" ON "StockLedgerEntry"("lotId");

-- CreateIndex
CREATE INDEX "StockCountSession_countType_periodKey_idx" ON "StockCountSession"("countType", "periodKey");

-- CreateIndex
CREATE INDEX "StockCountLine_lotId_idx" ON "StockCountLine"("lotId");

-- CreateIndex
CREATE INDEX "StockCountLine_locationId_idx" ON "StockCountLine"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_stockCountId_productId_lotId_locationId_key" ON "StockCountLine"("stockCountId", "productId", "lotId", "locationId");

-- CreateIndex
CREATE INDEX "StockAdjustmentApproval_lotId_idx" ON "StockAdjustmentApproval"("lotId");

-- CreateIndex
CREATE INDEX "StockAdjustmentApproval_locationId_idx" ON "StockAdjustmentApproval"("locationId");

-- CreateIndex
CREATE INDEX "DispatchLine_pickLineId_idx" ON "DispatchLine"("pickLineId");

-- CreateIndex
CREATE INDEX "DispatchLine_lotId_idx" ON "DispatchLine"("lotId");

-- CreateIndex
CREATE INDEX "DispatchLine_locationId_idx" ON "DispatchLine"("locationId");

-- CreateIndex
CREATE INDEX "ReturnLine_dispatchLineId_idx" ON "ReturnLine"("dispatchLineId");

-- CreateIndex
CREATE INDEX "ReturnLine_salesOrderLineId_idx" ON "ReturnLine"("salesOrderLineId");

-- CreateIndex
CREATE INDEX "ReturnLine_lotId_idx" ON "ReturnLine"("lotId");

-- CreateIndex
CREATE INDEX "ReturnLine_locationId_idx" ON "ReturnLine"("locationId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ProductBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_finishId_fkey" FOREIGN KEY ("finishId") REFERENCES "ProductFinish"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ProductMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tileSizeId_fkey" FOREIGN KEY ("tileSizeId") REFERENCES "TileSize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisplaySample" ADD CONSTRAINT "DisplaySample_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLotBalance" ADD CONSTRAINT "InventoryLotBalance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLotBalance" ADD CONSTRAINT "InventoryLotBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLotLedgerEntry" ADD CONSTRAINT "InventoryLotLedgerEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLotLedgerEntry" ADD CONSTRAINT "InventoryLotLedgerEntry_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLotLedgerEntry" ADD CONSTRAINT "InventoryLotLedgerEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningStockSession" ADD CONSTRAINT "OpeningStockSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningStockLine" ADD CONSTRAINT "OpeningStockLine_openingStockSessionId_fkey" FOREIGN KEY ("openingStockSessionId") REFERENCES "OpeningStockSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningStockLine" ADD CONSTRAINT "OpeningStockLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningStockLine" ADD CONSTRAINT "OpeningStockLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotReservation" ADD CONSTRAINT "LotReservation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotReservation" ADD CONSTRAINT "LotReservation_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotReservation" ADD CONSTRAINT "LotReservation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotReservation" ADD CONSTRAINT "LotReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickList" ADD CONSTRAINT "PickList_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickList" ADD CONSTRAINT "PickList_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickLine" ADD CONSTRAINT "PickLine_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "PickList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickLine" ADD CONSTRAINT "PickLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickLine" ADD CONSTRAINT "PickLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickLine" ADD CONSTRAINT "PickLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickLine" ADD CONSTRAINT "PickLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLabelInstance" ADD CONSTRAINT "InternalLabelInstance_labelJobId_fkey" FOREIGN KEY ("labelJobId") REFERENCES "InternalLabelJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLabelInstance" ADD CONSTRAINT "InternalLabelInstance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLabelInstance" ADD CONSTRAINT "InternalLabelInstance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLabelInstance" ADD CONSTRAINT "InternalLabelInstance_displaySampleId_fkey" FOREIGN KEY ("displaySampleId") REFERENCES "DisplaySample"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalScanEvent" ADD CONSTRAINT "InternalScanEvent_labelInstanceId_fkey" FOREIGN KEY ("labelInstanceId") REFERENCES "InternalLabelInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountSession" ADD CONSTRAINT "StockCountSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentApproval" ADD CONSTRAINT "StockAdjustmentApproval_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentApproval" ADD CONSTRAINT "StockAdjustmentApproval_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentApproval" ADD CONSTRAINT "StockAdjustmentApproval_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPeriodSnapshot" ADD CONSTRAINT "InventoryPeriodSnapshot_inventoryPeriodCloseId_fkey" FOREIGN KEY ("inventoryPeriodCloseId") REFERENCES "InventoryPeriodClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPeriodSnapshot" ADD CONSTRAINT "InventoryPeriodSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPeriodSnapshot" ADD CONSTRAINT "InventoryPeriodSnapshot_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPeriodSnapshot" ADD CONSTRAINT "InventoryPeriodSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_pickLineId_fkey" FOREIGN KEY ("pickLineId") REFERENCES "PickLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_dispatchLineId_fkey" FOREIGN KEY ("dispatchLineId") REFERENCES "DispatchLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed governed values required by dropdown-driven product onboarding.
INSERT INTO "UnitOfMeasure" ("id", "code", "name", "dimension", "decimalScale", "status", "sortOrder", "metadata", "updatedAt") VALUES
  ('uom-pc', 'PC', 'Piece', 'count', 0, 'active', 10, '{}', CURRENT_TIMESTAMP),
  ('uom-box', 'BOX', 'Box', 'count', 0, 'active', 20, '{}', CURRENT_TIMESTAMP),
  ('uom-set', 'SET', 'Set', 'count', 0, 'active', 30, '{}', CURRENT_TIMESTAMP),
  ('uom-pair', 'PAIR', 'Pair', 'count', 0, 'active', 40, '{}', CURRENT_TIMESTAMP),
  ('uom-sqm', 'SQM', 'Square metre', 'area', 3, 'active', 50, '{}', CURRENT_TIMESTAMP),
  ('uom-mtr', 'MTR', 'Metre', 'length', 3, 'active', 60, '{}', CURRENT_TIMESTAMP),
  ('uom-kg', 'KG', 'Kilogram', 'weight', 3, 'active', 70, '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "TaxCode" ("id", "code", "name", "hsnCode", "rate", "status", "sortOrder", "metadata", "updatedAt") VALUES
  ('tax-gst-0', 'GST_0', 'GST 0%', NULL, 0, 'active', 10, '{}', CURRENT_TIMESTAMP),
  ('tax-gst-5', 'GST_5', 'GST 5%', NULL, 5, 'active', 20, '{}', CURRENT_TIMESTAMP),
  ('tax-gst-12', 'GST_12', 'GST 12%', NULL, 12, 'active', 30, '{}', CURRENT_TIMESTAMP),
  ('tax-gst-18', 'GST_18', 'GST 18%', NULL, 18, 'active', 40, '{}', CURRENT_TIMESTAMP),
  ('tax-gst-28', 'GST_28', 'GST 28%', NULL, 28, 'active', 50, '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "ProductMaterial" ("id", "name", "code", "status", "sortOrder", "metadata", "updatedAt") VALUES
  ('material-ceramic', 'Ceramic', 'CERAMIC', 'active', 10, '{}', CURRENT_TIMESTAMP),
  ('material-porcelain', 'Porcelain', 'PORCELAIN', 'active', 20, '{}', CURRENT_TIMESTAMP),
  ('material-vitrified', 'Vitrified', 'VITRIFIED', 'active', 30, '{}', CURRENT_TIMESTAMP),
  ('material-brass', 'Brass', 'BRASS', 'active', 40, '{}', CURRENT_TIMESTAMP),
  ('material-stainless-steel', 'Stainless Steel', 'SS', 'active', 50, '{}', CURRENT_TIMESTAMP),
  ('material-granite-composite', 'Granite Composite', 'GRANITE_COMPOSITE', 'active', 60, '{}', CURRENT_TIMESTAMP),
  ('material-acrylic', 'Acrylic', 'ACRYLIC', 'active', 70, '{}', CURRENT_TIMESTAMP),
  ('material-glass', 'Glass', 'GLASS', 'active', 80, '{}', CURRENT_TIMESTAMP),
  ('material-pvc', 'PVC', 'PVC', 'active', 90, '{}', CURRENT_TIMESTAMP),
  ('material-abs', 'ABS', 'ABS', 'active', 100, '{}', CURRENT_TIMESTAMP),
  ('material-natural-stone', 'Natural Stone', 'NATURAL_STONE', 'active', 110, '{}', CURRENT_TIMESTAMP),
  ('material-engineered-stone', 'Engineered Stone', 'ENGINEERED_STONE', 'active', 120, '{}', CURRENT_TIMESTAMP),
  ('material-other', 'Other', 'OTHER', 'active', 999, '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- Backfill normalized product references while retaining legacy display strings.
UPDATE "Product" p SET
  "internalCode" = p."sku",
  "baseUom" = COALESCE(NULLIF(BTRIM(p."unit"), ''), 'PC'),
  "purchaseUom" = COALESCE(NULLIF(BTRIM(p."unit"), ''), 'PC'),
  "salesUom" = COALESCE(NULLIF(BTRIM(p."unit"), ''), 'PC')
WHERE p."internalCode" IS NULL;

UPDATE "Product" p SET "categoryId" = c.id
FROM "ProductCategory" c
WHERE p."categoryId" IS NULL AND LOWER(BTRIM(p."category")) = LOWER(BTRIM(c."name"));

UPDATE "Product" p SET "brandId" = b.id
FROM "ProductBrand" b
WHERE p."brandId" IS NULL AND LOWER(BTRIM(p."brand")) = LOWER(BTRIM(b."name"));

UPDATE "Product" p SET "finishId" = f.id
FROM "ProductFinish" f
WHERE p."finishId" IS NULL AND LOWER(BTRIM(p."finish")) = LOWER(BTRIM(f."name"));

UPDATE "StockCountLine" line SET "locationId" = session."locationId"
FROM "StockCountSession" session
WHERE line."stockCountId" = session.id AND line."locationId" IS NULL AND session."locationId" IS NOT NULL;

-- Preserve pre-migration product/location stock as explicitly isolated legacy lots.
INSERT INTO "InventoryLot" (
  "id", "lotNumber", "productId", "sourceType", "sourceId", "sourceLineId", "qualityStatus",
  "receivedAt", "unitCost", "status", "attributes", "metadata", "createdBy", "updatedAt"
)
SELECT
  'legacy-lot-' || p.id,
  'LEGACY-OPEN-' || p."sku",
  p.id,
  'legacy_opening',
  p.id,
  'aggregate-migration',
  'available',
  CURRENT_TIMESTAMP,
  0,
  'active',
  '{"legacy":true,"batch":"UNKNOWN"}'::jsonb,
  '{"migration":"20260716170000_universal_inventory_lifecycle"}'::jsonb,
  'migration',
  CURRENT_TIMESTAMP
FROM "Product" p
WHERE EXISTS (
  SELECT 1 FROM "StockBalanceByLocation" b
  WHERE b."productId" = p.id AND (b."onHand" <> 0 OR b."reserved" <> 0 OR b."damaged" <> 0 OR b."hold" <> 0)
)
ON CONFLICT ("lotNumber") DO NOTHING;

INSERT INTO "InventoryLotBalance" (
  "id", "lotId", "locationId", "onHand", "reserved", "damaged", "hold", "available", "updatedAt"
)
SELECT
  'legacy-lot-balance-' || md5(b."productId" || ':' || b."locationId"),
  'legacy-lot-' || b."productId",
  b."locationId",
  b."onHand",
  b."reserved",
  b."damaged",
  b."hold",
  GREATEST(0, b."onHand" - b."reserved" - b."damaged" - b."hold"),
  CURRENT_TIMESTAMP
FROM "StockBalanceByLocation" b
JOIN "InventoryLot" lot ON lot.id = 'legacy-lot-' || b."productId"
WHERE b."onHand" <> 0 OR b."reserved" <> 0 OR b."damaged" <> 0 OR b."hold" <> 0
ON CONFLICT ("lotId", "locationId") DO NOTHING;

INSERT INTO "InventoryLotLedgerEntry" (
  "id", "idempotencyKey", "productId", "lotId", "locationId", "type", "direction", "quantity",
  "onHandDelta", "reservedDelta", "damagedDelta", "holdDelta", "balanceAfter", "referenceType",
  "referenceId", "sourceDocumentNo", "unitCost", "reason", "createdBy", "metadata"
)
SELECT
  'legacy-lot-ledger-' || md5(lb."lotId" || ':' || lb."locationId"),
  'legacy-opening:' || lb."lotId" || ':' || lb."locationId",
  lot."productId",
  lb."lotId",
  lb."locationId",
  'legacy_opening',
  'in',
  lb."onHand",
  lb."onHand",
  lb."reserved",
  lb."damaged",
  lb."hold",
  jsonb_build_object('onHand', lb."onHand", 'reserved', lb."reserved", 'damaged', lb."damaged", 'hold', lb."hold", 'available', lb."available"),
  'Migration',
  '20260716170000_universal_inventory_lifecycle',
  'LEGACY-OPEN',
  0,
  'Opening position migrated from product/location aggregate stock',
  'migration',
  '{"legacy":true}'::jsonb
FROM "InventoryLotBalance" lb
JOIN "InventoryLot" lot ON lot.id = lb."lotId"
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Database invariants: physical quantities cannot silently become impossible.
ALTER TABLE "Product" ADD CONSTRAINT "Product_packaging_positive_chk"
  CHECK ("piecesPerPack" > 0 AND "coveragePerPack" >= 0);
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_nonnegative_chk"
  CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "available" >= 0 AND "damaged" >= 0 AND "hold" >= 0);
ALTER TABLE "StockBalanceByLocation" ADD CONSTRAINT "StockBalanceByLocation_nonnegative_chk"
  CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "damaged" >= 0 AND "hold" >= 0);
ALTER TABLE "InventoryLotBalance" ADD CONSTRAINT "InventoryLotBalance_nonnegative_chk"
  CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "damaged" >= 0 AND "hold" >= 0 AND "available" >= 0);
ALTER TABLE "InventoryLotBalance" ADD CONSTRAINT "InventoryLotBalance_available_chk"
  CHECK ("available" = GREATEST(0, "onHand" - "reserved" - "damaged" - "hold"));
ALTER TABLE "InventoryLotLedgerEntry" ADD CONSTRAINT "InventoryLotLedgerEntry_quantity_chk"
  CHECK ("quantity" > 0 AND "direction" IN ('in', 'out', 'neutral', 'reserve', 'release', 'damage', 'damage_release', 'hold', 'hold_release'));
ALTER TABLE "OpeningStockLine" ADD CONSTRAINT "OpeningStockLine_quantity_chk"
  CHECK ("quantity" > 0 AND "unitCost" >= 0);
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_distinct_locations_chk"
  CHECK ("sourceLocationId" <> "destinationLocationId");
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_quantities_chk"
  CHECK ("requestedQuantity" > 0 AND "dispatchedQuantity" >= 0 AND "receivedQuantity" >= 0 AND "damagedQuantity" >= 0 AND "dispatchedQuantity" <= "requestedQuantity" AND "receivedQuantity" + "damagedQuantity" <= "dispatchedQuantity");
ALTER TABLE "LotReservation" ADD CONSTRAINT "LotReservation_quantity_chk" CHECK ("quantity" > 0);
ALTER TABLE "PickLine" ADD CONSTRAINT "PickLine_quantities_chk"
  CHECK ("requestedQuantity" > 0 AND "pickedQuantity" >= 0 AND "packedQuantity" >= 0 AND "pickedQuantity" <= "requestedQuantity" AND "packedQuantity" <= "pickedQuantity");
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_quantities_chk"
  CHECK ("expectedQuantity" >= 0 AND "countedQuantity" >= 0 AND "variance" = "countedQuantity" - "expectedQuantity");
ALTER TABLE "StockAdjustmentApproval" ADD CONSTRAINT "StockAdjustmentApproval_quantity_chk" CHECK ("quantity" <> 0);
ALTER TABLE "InternalLabelJob" ADD CONSTRAINT "InternalLabelJob_quantity_chk" CHECK ("quantity" > 0);
ALTER TABLE "InternalLabelInstance" ADD CONSTRAINT "InternalLabelInstance_target_chk"
  CHECK (num_nonnulls("productId", "lotId", "displaySampleId") >= 1);
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_quantities_chk"
  CHECK ("quantity" > 0 AND "acceptedQuantity" >= 0 AND "resellQuantity" >= 0 AND "damagedQuantity" >= 0 AND "supplierReturnQuantity" >= 0 AND "acceptedQuantity" <= "quantity" AND "resellQuantity" + "damagedQuantity" + "supplierReturnQuantity" <= "acceptedQuantity");
ALTER TABLE "InventoryPeriodSnapshot" ADD CONSTRAINT "InventoryPeriodSnapshot_quantities_chk"
  CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "damaged" >= 0 AND "hold" >= 0 AND "available" >= 0 AND "unitCost" >= 0 AND "stockValue" >= 0);

CREATE UNIQUE INDEX "InventoryLot_source_identity_key"
  ON "InventoryLot" ("sourceType", "sourceId", COALESCE("sourceLineId", ''));

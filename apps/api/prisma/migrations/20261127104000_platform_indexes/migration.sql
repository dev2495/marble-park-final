-- Platform lane: indexes on id columns used in where clauses and joins.
-- No foreign keys here (existing rows may point at nothing; see scripts/check-orphan-links.mjs).

CREATE INDEX IF NOT EXISTS "ShowroomVisit_customerId_idx" ON "ShowroomVisit"("customerId");
CREATE INDEX IF NOT EXISTS "ShowroomVisitScan_productId_idx" ON "ShowroomVisitScan"("productId");
CREATE INDEX IF NOT EXISTS "PurchaseDemand_customerId_idx" ON "PurchaseDemand"("customerId");
CREATE INDEX IF NOT EXISTS "PurchaseDemand_ownerId_idx" ON "PurchaseDemand"("ownerId");
CREATE INDEX IF NOT EXISTS "PurchaseDemand_preferredVendorId_idx" ON "PurchaseDemand"("preferredVendorId");
CREATE INDEX IF NOT EXISTS "GoodsReceiptNote_vendorId_idx" ON "GoodsReceiptNote"("vendorId");
CREATE INDEX IF NOT EXISTS "LeadIntent_customerId_idx" ON "LeadIntent"("customerId");
CREATE INDEX IF NOT EXISTS "LeadIntent_quoteId_idx" ON "LeadIntent"("quoteId");
CREATE INDEX IF NOT EXISTS "LeadIntent_salesOrderId_idx" ON "LeadIntent"("salesOrderId");
CREATE INDEX IF NOT EXISTS "Notification_assignedUserId_idx" ON "Notification"("assignedUserId");
CREATE INDEX IF NOT EXISTS "SalesOrderLine_quoteLineId_idx" ON "SalesOrderLine"("quoteLineId");
CREATE INDEX IF NOT EXISTS "SalesInvoice_quoteId_idx" ON "SalesInvoice"("quoteId");
CREATE INDEX IF NOT EXISTS "InventoryLot_sourceId_idx" ON "InventoryLot"("sourceId");
CREATE INDEX IF NOT EXISTS "LotReservation_locationId_idx" ON "LotReservation"("locationId");
CREATE INDEX IF NOT EXISTS "PickLine_productId_idx" ON "PickLine"("productId");
CREATE INDEX IF NOT EXISTS "PickLine_locationId_idx" ON "PickLine"("locationId");
CREATE INDEX IF NOT EXISTS "InternalLabelJob_labelTemplateId_idx" ON "InternalLabelJob"("labelTemplateId");
CREATE INDEX IF NOT EXISTS "InternalScanEvent_labelInstanceId_idx" ON "InternalScanEvent"("labelInstanceId");
CREATE INDEX IF NOT EXISTS "InternalScanEvent_locationId_idx" ON "InternalScanEvent"("locationId");
CREATE INDEX IF NOT EXISTS "InventoryPeriodClose_countSessionId_idx" ON "InventoryPeriodClose"("countSessionId");

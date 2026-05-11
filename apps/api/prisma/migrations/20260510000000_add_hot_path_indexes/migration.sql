-- CreateIndex
CREATE INDEX IF NOT EXISTS "Activity_leadId_idx" ON "Activity"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Activity_quoteId_idx" ON "Activity"("quoteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Activity_userId_idx" ON "Activity"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Activity_type_idx" ON "Activity"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Activity_createdAt_idx" ON "Activity"("createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Customer_mobile_idx" ON "Customer"("mobile");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Customer_gstNo_idx" ON "Customer"("gstNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DispatchChallan_quoteId_idx" ON "DispatchChallan"("quoteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DispatchChallan_dispatchJobId_idx" ON "DispatchChallan"("dispatchJobId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DispatchChallan_customerId_idx" ON "DispatchChallan"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DispatchChallan_status_idx" ON "DispatchChallan"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DispatchChallan_createdAt_idx" ON "DispatchChallan"("createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DispatchJob_customerId_idx" ON "DispatchJob"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DispatchJob_ownerId_idx" ON "DispatchJob"("ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DispatchJob_status_idx" ON "DispatchJob"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DispatchJob_dueDate_idx" ON "DispatchJob"("dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpTask_leadId_idx" ON "FollowUpTask"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpTask_ownerId_idx" ON "FollowUpTask"("ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpTask_status_idx" ON "FollowUpTask"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpTask_dueAt_idx" ON "FollowUpTask"("dueAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryMovement_productId_idx" ON "InventoryMovement"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryMovement_type_idx" ON "InventoryMovement"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryMovement_relatedQuoteId_idx" ON "InventoryMovement"("relatedQuoteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryMovement_relatedChallanId_idx" ON "InventoryMovement"("relatedChallanId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_customerId_idx" ON "Lead"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_ownerId_idx" ON "Lead"("ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_stage_idx" ON "Lead"("stage");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_nextActionAt_idx" ON "Lead"("nextActionAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead"("createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_brand_idx" ON "Product"("brand");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_finish_idx" ON "Product"("finish");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quote_leadId_idx" ON "Quote"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quote_ownerId_idx" ON "Quote"("ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quote_approvalStatus_idx" ON "Quote"("approvalStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quote_validUntil_idx" ON "Quote"("validUntil");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quote_createdAt_idx" ON "Quote"("createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reservation_quoteId_status_idx" ON "Reservation"("quoteId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reservation_productId_status_idx" ON "Reservation"("productId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reservation_status_idx" ON "Reservation"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reservation_createdAt_idx" ON "Reservation"("createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");


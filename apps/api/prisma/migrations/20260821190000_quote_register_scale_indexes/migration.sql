-- Compound sort/filter indexes for the normal owner and sales quote queues.
CREATE INDEX "Quote_ownerId_createdAt_idx" ON "Quote"("ownerId", "createdAt" DESC);
CREATE INDEX "Quote_ownerId_status_createdAt_idx" ON "Quote"("ownerId", "status", "createdAt" DESC);
CREATE INDEX "Quote_status_createdAt_idx" ON "Quote"("status", "createdAt" DESC);

-- The register deliberately supports contains-search across document and
-- related human names. Trigram indexes keep that behavior usable as the
-- daily quote history grows into tens of thousands of rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Quote_quoteNumber_trgm_idx" ON "Quote" USING GIN ("quoteNumber" gin_trgm_ops);
CREATE INDEX "Quote_title_trgm_idx" ON "Quote" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Quote_projectName_trgm_idx" ON "Quote" USING GIN ("projectName" gin_trgm_ops);
CREATE INDEX "Quote_architectName_trgm_idx" ON "Quote" USING GIN ("architectName" gin_trgm_ops);
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);

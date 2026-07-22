CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_internalCode_trgm_idx" ON "Product" USING GIN ("internalCode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_brand_trgm_idx" ON "Product" USING GIN ("brand" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ProductAlias_normalizedValue_trgm_idx" ON "ProductAlias" USING GIN ("normalizedValue" gin_trgm_ops);

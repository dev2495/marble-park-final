CREATE TABLE "ProductMrpHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "previousMrpInclusive" DECIMAL(18,2),
    "newMrpInclusive" DECIMAL(18,2) NOT NULL,
    "priceRateBasis" TEXT NOT NULL,
    "priceUom" TEXT NOT NULL,
    "source" TEXT,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductMrpHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductMrpHistory_product_created_idx"
    ON "ProductMrpHistory"("productId", "createdAt" DESC);

CREATE INDEX "ProductMrpHistory_actor_created_idx"
    ON "ProductMrpHistory"("changedById", "createdAt" DESC);

CREATE INDEX "ProductMrpHistory_created_idx"
    ON "ProductMrpHistory"("createdAt" DESC);

ALTER TABLE "ProductMrpHistory"
    ADD CONSTRAINT "ProductMrpHistory_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

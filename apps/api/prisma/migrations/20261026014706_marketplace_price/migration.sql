-- CreateTable
CREATE TABLE "MarketplacePrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplacePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplacePrice_tenantId_fetchedAt_idx" ON "MarketplacePrice"("tenantId", "fetchedAt");

-- CreateIndex
CREATE INDEX "MarketplacePrice_tenantId_productName_idx" ON "MarketplacePrice"("tenantId", "productName");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePrice_tenantId_productName_marketplace_link_key" ON "MarketplacePrice"("tenantId", "productName", "marketplace", "link");

-- CreateTable
CREATE TABLE "PriceSignal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "ownPrice" DOUBLE PRECISION,
    "marketPrice" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT NOT NULL DEFAULT '',
    "sourceName" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceSignal_tenantId_fetchedAt_idx" ON "PriceSignal"("tenantId", "fetchedAt");

-- CreateIndex
CREATE INDEX "PriceSignal_tenantId_productName_idx" ON "PriceSignal"("tenantId", "productName");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSignal_tenantId_sourceUrl_key" ON "PriceSignal"("tenantId", "sourceUrl");

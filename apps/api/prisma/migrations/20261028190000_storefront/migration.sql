-- Storefront publik per perusahaan (satu tenant = satu database Accurate)
CREATE TABLE "Storefront" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'product',
    "template" TEXT NOT NULL DEFAULT 'product-1',
    "tagline" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "whatsapp" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "productsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Storefront_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorefrontProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemNo" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "price" DOUBLE PRECISION,
    "stock" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Storefront_tenantId_key" ON "Storefront"("tenantId");
CREATE UNIQUE INDEX "Storefront_slug_key" ON "Storefront"("slug");
CREATE INDEX "Storefront_active_idx" ON "Storefront"("active");
CREATE UNIQUE INDEX "StorefrontProduct_tenantId_itemNo_key" ON "StorefrontProduct"("tenantId", "itemNo");
CREATE INDEX "StorefrontProduct_tenantId_active_sortOrder_idx" ON "StorefrontProduct"("tenantId", "active", "sortOrder");

ALTER TABLE "Storefront" ADD CONSTRAINT "Storefront_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorefrontProduct" ADD CONSTRAINT "StorefrontProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

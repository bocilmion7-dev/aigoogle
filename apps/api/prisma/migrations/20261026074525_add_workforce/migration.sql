-- CreateTable
CREATE TABLE "WorkforceConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "dailyQuota" INTEGER NOT NULL DEFAULT 5,
    "monthlyGoal" INTEGER NOT NULL DEFAULT 10,
    "industries" TEXT NOT NULL DEFAULT '',
    "regions" TEXT NOT NULL DEFAULT '',
    "bizTypes" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "offerTemplate" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceLead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'csv',
    "status" TEXT NOT NULL DEFAULT 'new',
    "industry" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "products" JSONB,
    "total" INTEGER,
    "qrUrl" TEXT,
    "paymentOrderId" TEXT,
    "accurate" JSONB,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceConfig_tenantId_key" ON "WorkforceConfig"("tenantId");

-- CreateIndex
CREATE INDEX "WorkforceConfig_tenantId_idx" ON "WorkforceConfig"("tenantId");

-- CreateIndex
CREATE INDEX "WorkforceLead_tenantId_status_idx" ON "WorkforceLead"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WorkforceLead_tenantId_createdAt_idx" ON "WorkforceLead"("tenantId", "createdAt");

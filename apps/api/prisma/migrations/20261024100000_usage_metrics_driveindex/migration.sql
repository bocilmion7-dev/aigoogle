-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "calls" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "salesTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "purchaseTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchaseCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveIndex" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "modifiedTime" TEXT NOT NULL DEFAULT '',
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmUsage_tenantId_day_idx" ON "LlmUsage"("tenantId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "LlmUsage_tenantId_day_kind_model_key" ON "LlmUsage"("tenantId", "day", "kind", "model");

-- CreateIndex
CREATE INDEX "DailyMetric_tenantId_date_idx" ON "DailyMetric"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetric_tenantId_date_key" ON "DailyMetric"("tenantId", "date");

-- CreateIndex
CREATE INDEX "DriveIndex_tenantId_name_idx" ON "DriveIndex"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DriveIndex_tenantId_fileId_key" ON "DriveIndex"("tenantId", "fileId");


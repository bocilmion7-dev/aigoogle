-- DropIndex
DROP INDEX "WaBalance_tenantId_key";

-- CreateTable
CREATE TABLE "GeminiModel" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "lastOkAt" TIMESTAMP(3),
    "lastFailAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeminiModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeminiModel_action_rank_idx" ON "GeminiModel"("action", "rank");

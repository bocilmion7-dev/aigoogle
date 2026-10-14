/*
  Warnings:

  - You are about to drop the `ModelPool` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "ModelPool";

-- CreateTable
CREATE TABLE "AiProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderModel" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "lastOkAt" TIMESTAMP(3),
    "lastFailAt" TIMESTAMP(3),

    CONSTRAINT "AiProviderModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProviderModel_providerId_rank_idx" ON "AiProviderModel"("providerId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderModel_providerId_name_key" ON "AiProviderModel"("providerId", "name");

-- AddForeignKey
ALTER TABLE "AiProviderModel" ADD CONSTRAINT "AiProviderModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

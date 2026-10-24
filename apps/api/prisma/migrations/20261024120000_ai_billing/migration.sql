-- CreateTable
CREATE TABLE "AiWallet" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWallet_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AiLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL DEFAULT '',
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "refId" TEXT NOT NULL DEFAULT '',
    "meta" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTopup" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentMethod" TEXT NOT NULL DEFAULT 'qris',
    "providerRef" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTopup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModelPrice" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "openrouterId" TEXT NOT NULL DEFAULT '',
    "inputUsdPer1M" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "outputUsdPer1M" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    "markup" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiWallet_tenantId_idx" ON "AiWallet"("tenantId");

-- CreateIndex
CREATE INDEX "AiLedger_userId_createdAt_idx" ON "AiLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiLedger_tenantId_createdAt_idx" ON "AiLedger"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiTopup_orderId_key" ON "AiTopup"("orderId");

-- CreateIndex
CREATE INDEX "AiTopup_userId_idx" ON "AiTopup"("userId");

-- CreateIndex
CREATE INDEX "AiTopup_tenantId_idx" ON "AiTopup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AiModelPrice_model_key" ON "AiModelPrice"("model");


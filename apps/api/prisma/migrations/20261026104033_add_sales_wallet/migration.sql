-- CreateTable
CREATE TABLE "SalesWallet" (
    "tenantId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesWallet_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "SalesWalletTx" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesWalletTx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesWithdrawal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "bankName" TEXT NOT NULL DEFAULT '',
    "bankNo" TEXT NOT NULL DEFAULT '',
    "accountName" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesWalletTx_tenantId_createdAt_idx" ON "SalesWalletTx"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesWithdrawal_tenantId_createdAt_idx" ON "SalesWithdrawal"("tenantId", "createdAt");

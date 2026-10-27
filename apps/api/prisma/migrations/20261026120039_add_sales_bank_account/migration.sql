-- CreateTable
CREATE TABLE "SalesBankAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankShortCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "activityId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesBankAccount_tenantId_idx" ON "SalesBankAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesBankAccount_tenantId_bankShortCode_accountNo_key" ON "SalesBankAccount"("tenantId", "bankShortCode", "accountNo");

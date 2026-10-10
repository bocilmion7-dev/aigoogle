-- CreateTable
CREATE TABLE "DriveJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "folderName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "planJson" TEXT NOT NULL DEFAULT '[]',
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveActionLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "fromParent" TEXT NOT NULL DEFAULT '',
    "toParent" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveActionLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DriveJob" ADD CONSTRAINT "DriveJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveActionLog" ADD CONSTRAINT "DriveActionLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DriveJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AccurateWebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "dbId" TEXT NOT NULL DEFAULT '',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccurateWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccurateWebhookEvent_tenantId_event_createdAt_idx" ON "AccurateWebhookEvent"("tenantId", "event", "createdAt");

-- AddForeignKey
ALTER TABLE "AccurateWebhookEvent" ADD CONSTRAINT "AccurateWebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

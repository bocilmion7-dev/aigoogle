-- AlterTable
ALTER TABLE "WaMessageLog" ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'out',
ADD COLUMN     "waserverOutboxId" INTEGER;

-- CreateIndex
CREATE INDEX "WaMessageLog_waserverOutboxId_idx" ON "WaMessageLog"("waserverOutboxId");

-- AlterTable
ALTER TABLE "BreakoutSignal" ADD COLUMN     "alertSentAt" TIMESTAMP(3),
ADD COLUMN     "assetType" TEXT NOT NULL DEFAULT 'stock',
ADD COLUMN     "assetUnderManagement" DOUBLE PRECISION,
ADD COLUMN     "epsBeat" BOOLEAN,
ADD COLUMN     "epsGrowthPct" DOUBLE PRECISION,
ADD COLUMN     "epsSurprisePct" DOUBLE PRECISION,
ADD COLUMN     "etfCategory" TEXT,
ADD COLUMN     "expenseRatio" DOUBLE PRECISION,
ADD COLUMN     "fedFundsRate" DOUBLE PRECISION,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "lastAlertAt" TIMESTAMP(3),
ADD COLUMN     "lastAlertPrice" DOUBLE PRECISION,
ADD COLUMN     "revenueGrowthPct" DOUBLE PRECISION,
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "volumeRatio" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "RemovedAsset" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemovedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RemovedAsset_asset_key" ON "RemovedAsset"("asset");

-- CreateIndex
CREATE INDEX "RemovedAsset_asset_idx" ON "RemovedAsset"("asset");

-- CreateIndex
CREATE INDEX "BreakoutSignal_asset_alertSentAt_idx" ON "BreakoutSignal"("asset", "alertSentAt");

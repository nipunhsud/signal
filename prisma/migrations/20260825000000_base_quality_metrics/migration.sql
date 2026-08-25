-- Base-quality metrics on breakout signals: relative-strength percentile,
-- up/down volume (accumulation), failed pokes at the pivot, blue-sky flag,
-- and the coil (tightening) ratio.
ALTER TABLE "BreakoutSignal" ADD COLUMN "rsRating" INTEGER;
ALTER TABLE "BreakoutSignal" ADD COLUMN "upDownVolumeRatio" DOUBLE PRECISION;
ALTER TABLE "BreakoutSignal" ADD COLUMN "failedPokes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BreakoutSignal" ADD COLUMN "isBlueSky" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BreakoutSignal" ADD COLUMN "coilRatio" DOUBLE PRECISION;

-- Cross-sectional store of trailing returns so relative strength can be ranked
-- across the whole universe even though scanning is split across tier containers.
CREATE TABLE "AssetReturn" (
    "asset" TEXT NOT NULL,
    "assetType" TEXT NOT NULL DEFAULT 'stock',
    "rsScore" DOUBLE PRECISION NOT NULL,
    "return1wPct" DOUBLE PRECISION,
    "return1mPct" DOUBLE PRECISION,
    "return3mPct" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetReturn_pkey" PRIMARY KEY ("asset")
);
CREATE INDEX "AssetReturn_assetType_updatedAt_idx" ON "AssetReturn"("assetType", "updatedAt");

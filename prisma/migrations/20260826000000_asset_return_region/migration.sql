-- RS percentiles must be per-market: an Indian stock's relative strength is
-- its rank vs other Indian stocks, not vs the US universe. Backfill from the
-- symbol suffix (.NS/.BO = NSE/BSE).
ALTER TABLE "AssetReturn" ADD COLUMN "region" TEXT NOT NULL DEFAULT 'US';
UPDATE "AssetReturn" SET "region" = 'IN' WHERE "asset" ~* '\.(NS|BO)$';
DROP INDEX IF EXISTS "AssetReturn_assetType_updatedAt_idx";
CREATE INDEX "AssetReturn_region_assetType_updatedAt_idx" ON "AssetReturn"("region", "assetType", "updatedAt");

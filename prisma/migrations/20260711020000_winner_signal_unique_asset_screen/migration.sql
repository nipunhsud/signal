-- Dedupe: keep only the newest row per (asset, screenType).
DELETE FROM "WinnerSignal" a
USING "WinnerSignal" b
WHERE a."asset" = b."asset"
  AND a."screenType" = b."screenType"
  AND a."createdAt" < b."createdAt";

-- Enforce one row per (asset, screenType) going forward.
CREATE UNIQUE INDEX "WinnerSignal_asset_screenType_key"
  ON "WinnerSignal"("asset", "screenType");

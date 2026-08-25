-- Sector on the returns store, so sector strength can be rolled up from the
-- same cross-sectional data RS ranks on. Populated by the next scan cycles.
ALTER TABLE "AssetReturn" ADD COLUMN "sector" TEXT;

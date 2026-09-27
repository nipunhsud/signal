-- Near Pivot tab: graded bases still forming, one row per asset.
CREATE TABLE "BaseWatch" (
  "asset" TEXT NOT NULL,
  "region" TEXT NOT NULL DEFAULT 'US',
  "grade" TEXT NOT NULL,
  "pivot" DOUBLE PRECISION NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "pctToPivot" DOUBLE PRECISION NOT NULL,
  "baseBars" INTEGER NOT NULL,
  "depthPct" DOUBLE PRECISION NOT NULL,
  "rsRating" INTEGER,
  "sector" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BaseWatch_pkey" PRIMARY KEY ("asset")
);
CREATE INDEX "BaseWatch_region_updatedAt_idx" ON "BaseWatch"("region", "updatedAt");
-- Industry rollup on the Sectors tab.
ALTER TABLE "AssetReturn" ADD COLUMN "industry" TEXT;

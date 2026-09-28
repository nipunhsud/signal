-- Form 4 insider activity, one row per asset, refreshed nightly from SEC EDGAR.
CREATE TABLE "InsiderActivity" (
    "asset" TEXT NOT NULL,
    "cik" TEXT,
    "windowDays" INTEGER NOT NULL DEFAULT 90,
    "buys" INTEGER NOT NULL DEFAULT 0,
    "sells" INTEGER NOT NULL DEFAULT 0,
    "realSells" INTEGER NOT NULL DEFAULT 0,
    "plannedSells" INTEGER NOT NULL DEFAULT 0,
    "exerciseSells" INTEGER NOT NULL DEFAULT 0,
    "buyers" INTEGER NOT NULL DEFAULT 0,
    "sellers" INTEGER NOT NULL DEFAULT 0,
    "buyShares" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellShares" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "buyValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tone" TEXT NOT NULL DEFAULT 'quiet',
    "cluster" BOOLEAN NOT NULL DEFAULT false,
    "filings" INTEGER NOT NULL DEFAULT 0,
    "lastFiledAt" TEXT,
    "latestAt" TEXT,
    "latestKind" TEXT,
    "latestOwner" TEXT,
    "latestRole" TEXT,
    "latestShares" DOUBLE PRECISION,
    "latestPrice" DOUBLE PRECISION,
    "latestPlanned" BOOLEAN NOT NULL DEFAULT false,
    "latestLink" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsiderActivity_pkey" PRIMARY KEY ("asset")
);

CREATE INDEX "InsiderActivity_tone_idx" ON "InsiderActivity"("tone");
CREATE INDEX "InsiderActivity_checkedAt_idx" ON "InsiderActivity"("checkedAt");

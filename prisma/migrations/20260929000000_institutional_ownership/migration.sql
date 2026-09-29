-- Form 13F: the institutional register per stock per quarter, and the largest
-- named holders behind it.
CREATE TABLE "InstitutionalOwnership" (
    "asset" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "holders" INTEGER NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "holdersPrior" INTEGER,
    "sharesPrior" DOUBLE PRECISION,
    "valuePrior" DOUBLE PRECISION,
    "opened" INTEGER,
    "closed" INTEGER,
    "added" INTEGER,
    "reduced" INTEGER,
    "activeHolders" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionalOwnership_pkey" PRIMARY KEY ("asset","period")
);

CREATE INDEX "InstitutionalOwnership_asset_idx" ON "InstitutionalOwnership"("asset");
CREATE INDEX "InstitutionalOwnership_period_idx" ON "InstitutionalOwnership"("period");

CREATE TABLE "InstitutionalHolder" (
    "asset" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "manager" TEXT NOT NULL,
    "cik" TEXT,
    "shares" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "priorShares" DOUBLE PRECISION,
    "isIndex" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InstitutionalHolder_pkey" PRIMARY KEY ("asset","period","manager")
);

CREATE INDEX "InstitutionalHolder_asset_period_rank_idx" ON "InstitutionalHolder"("asset","period","rank");

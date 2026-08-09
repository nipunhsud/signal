-- CreateTable
CREATE TABLE "WinnerSignal" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "screenType" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "high52w" DOUBLE PRECISION,
    "distFrom52wHighPct" DOUBLE PRECISION,
    "ma50" DOUBLE PRECISION,
    "ma200" DOUBLE PRECISION,
    "maStacked" BOOLEAN NOT NULL DEFAULT false,
    "epsGrowthPct" DOUBLE PRECISION,
    "revenueGrowthPct" DOUBLE PRECISION,
    "earningsQuarter" INTEGER,
    "earningsYear" INTEGER,
    "sector" TEXT,
    "industry" TEXT,
    "signalDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WinnerSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WinnerSignal_asset_createdAt_idx" ON "WinnerSignal"("asset", "createdAt");

-- CreateIndex
CREATE INDEX "WinnerSignal_screenType_createdAt_idx" ON "WinnerSignal"("screenType", "createdAt");

-- CreateIndex
CREATE INDEX "WinnerSignal_tier_createdAt_idx" ON "WinnerSignal"("tier", "createdAt");

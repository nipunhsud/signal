-- CreateTable
CREATE TABLE "TranscriptAnalysis" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "tone" TEXT NOT NULL,
    "toneScore" DOUBLE PRECISION NOT NULL,
    "guidanceDirection" TEXT NOT NULL,
    "riskFlags" JSONB NOT NULL,
    "highlights" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptAnalysis_asset_quarter_year_key" ON "TranscriptAnalysis"("asset", "quarter", "year");

-- CreateIndex
CREATE INDEX "TranscriptAnalysis_asset_createdAt_idx" ON "TranscriptAnalysis"("asset", "createdAt");

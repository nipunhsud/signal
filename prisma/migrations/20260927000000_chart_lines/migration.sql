-- Lines the reader draws on a chart, so the screen can watch them.
-- Previously localStorage-only, invisible to the scanner.
CREATE TABLE "ChartLine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'segment',
    "t1" INTEGER NOT NULL,
    "p1" DOUBLE PRECISION NOT NULL,
    "t2" INTEGER NOT NULL,
    "p2" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "lastSide" TEXT,
    "lastCheck" TIMESTAMP(3),
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChartLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChartLine_userId_asset_idx" ON "ChartLine"("userId", "asset");
CREATE INDEX "ChartLine_asset_idx" ON "ChartLine"("asset");

ALTER TABLE "ChartLine" ADD CONSTRAINT "ChartLine_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

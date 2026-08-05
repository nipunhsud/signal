-- CreateTable
CREATE TABLE "MarketBreadth" (
    "id"           TEXT NOT NULL,
    "mode"         TEXT NOT NULL,
    "baseCount"    INTEGER NOT NULL,
    "handleCount"  INTEGER NOT NULL,
    "totalScanned" INTEGER NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketBreadth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketBreadth_mode_createdAt_idx" ON "MarketBreadth"("mode", "createdAt");

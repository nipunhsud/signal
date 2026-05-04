-- CreateTable
CREATE TABLE "Shortlist" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "notes" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shortlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shortlist_asset_key" ON "Shortlist"("asset");

-- CreateIndex
CREATE INDEX "Shortlist_asset_idx" ON "Shortlist"("asset");

-- X-ray base grade labels (full-history validation, Sep 2026)
ALTER TABLE "BreakoutSignal" ADD COLUMN "baseGrade" TEXT;
ALTER TABLE "BreakoutSignal" ADD COLUMN "volumeTag" TEXT;
ALTER TABLE "BreakoutSignal" ADD COLUMN "basePivot" DOUBLE PRECISION;
ALTER TABLE "BreakoutSignal" ADD COLUMN "baseBars" INTEGER;
ALTER TABLE "BreakoutSignal" ADD COLUMN "baseDepthPct" DOUBLE PRECISION;

-- Minervini trend template + pivot tightness labels (X-post study, Sep 2026)
ALTER TABLE "BreakoutSignal" ADD COLUMN "trendTemplate" BOOLEAN;
ALTER TABLE "BreakoutSignal" ADD COLUMN "pivotTightPct" DOUBLE PRECISION;

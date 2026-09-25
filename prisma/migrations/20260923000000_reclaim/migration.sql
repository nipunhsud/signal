-- Reclaim of a failed breakout on dried-up volume (CRWD Sep 2026), and the
-- bar that cleared the pivot: its date and volume (TWLO Sep 2026).
ALTER TABLE "BreakoutSignal" ADD COLUMN "isReclaim" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BreakoutSignal" ADD COLUMN "baseBreakoutDate" TEXT;
ALTER TABLE "BreakoutSignal" ADD COLUMN "baseBreakoutVolRatio" DOUBLE PRECISION;

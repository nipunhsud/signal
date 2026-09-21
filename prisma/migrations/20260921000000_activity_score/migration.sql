-- Institutional activity from the tape + sector rank at scan time (Sep 2026)
ALTER TABLE "BreakoutSignal" ADD COLUMN "activityScore" INTEGER;
ALTER TABLE "BreakoutSignal" ADD COLUMN "activityAcc" INTEGER;
ALTER TABLE "BreakoutSignal" ADD COLUMN "activityDist" INTEGER;
ALTER TABLE "BreakoutSignal" ADD COLUMN "activityBigUp" INTEGER;
ALTER TABLE "BreakoutSignal" ADD COLUMN "activityUdv" DOUBLE PRECISION;
ALTER TABLE "BreakoutSignal" ADD COLUMN "activityObv" DOUBLE PRECISION;
ALTER TABLE "BreakoutSignal" ADD COLUMN "sectorRank" INTEGER;
ALTER TABLE "BreakoutSignal" ADD COLUMN "sectorCount" INTEGER;

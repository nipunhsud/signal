-- Deep-base breakouts: the 25-35% band the grade's depth cut drops, alertable
-- on a 2x close through the pivot (docs/depth-cut-study.md).
ALTER TABLE "BreakoutSignal" ADD COLUMN "deepBase" BOOLEAN;

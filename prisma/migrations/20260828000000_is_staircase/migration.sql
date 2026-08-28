-- Progressive-contraction ("staircase") flag: stratifies the VCP cohort
-- 59.6% vs 50.7% win in the base study; persisted for live evidence.
ALTER TABLE "BreakoutSignal" ADD COLUMN "isStaircase" BOOLEAN NOT NULL DEFAULT false;

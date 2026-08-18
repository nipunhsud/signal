-- Track which BreakoutSignal assets have had an earnings-calendar-timed card
-- posted to X, so the intercept job dedups per-quarter (separate from xPostedAt,
-- which the teaser job owns).
ALTER TABLE "BreakoutSignal" ADD COLUMN "earningsPostedAt" TIMESTAMP(3);
CREATE INDEX "BreakoutSignal_earningsPostedAt_idx" ON "BreakoutSignal"("earningsPostedAt");

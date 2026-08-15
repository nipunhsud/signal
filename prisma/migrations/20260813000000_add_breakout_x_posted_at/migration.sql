-- Track which BreakoutSignal rows have been included in a posted X digest,
-- so the second daily digest does not repeat the same ticker.
ALTER TABLE "BreakoutSignal" ADD COLUMN "xPostedAt" TIMESTAMP(3);
CREATE INDEX "BreakoutSignal_xPostedAt_idx" ON "BreakoutSignal"("xPostedAt");

-- Track which earnings breakdowns have been posted to X, so the earnings-thread
-- job doesn't repeat the same analysis.
ALTER TABLE "TranscriptAnalysis" ADD COLUMN "xPostedAt" TIMESTAMP(3);
CREATE INDEX "TranscriptAnalysis_xPostedAt_idx" ON "TranscriptAnalysis"("xPostedAt");

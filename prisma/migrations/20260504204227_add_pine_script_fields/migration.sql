-- Add Pine Script breakout scanner fields
ALTER TABLE "BreakoutSignal"
ADD COLUMN "pineScriptGreen" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BreakoutSignal"
ADD COLUMN "barsInRange" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BreakoutSignal"
ADD COLUMN "bullishCandle" BOOLEAN NOT NULL DEFAULT false;

-- Add index for pineScriptGreen
CREATE INDEX "BreakoutSignal_pineScriptGreen_createdAt_idx" ON "BreakoutSignal"("pineScriptGreen", "createdAt");

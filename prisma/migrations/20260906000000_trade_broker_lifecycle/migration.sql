-- Trade table: broker-agnostic lifecycle for the restored trading agent
-- (Alpaca paper first). Existing IBKR rows keep their conid; the new
-- clientOrderId is backfilled from the row id so the unique index holds.
ALTER TABLE "Trade" ALTER COLUMN "conid" DROP NOT NULL;
ALTER TABLE "Trade" ADD COLUMN "broker" TEXT NOT NULL DEFAULT 'alpaca';
ALTER TABLE "Trade" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'paper';
ALTER TABLE "Trade" ADD COLUMN "clientOrderId" TEXT;
UPDATE "Trade" SET "clientOrderId" = "id" WHERE "clientOrderId" IS NULL;
ALTER TABLE "Trade" ALTER COLUMN "clientOrderId" SET NOT NULL;
ALTER TABLE "Trade" ADD COLUMN "stopOrderId" TEXT;
ALTER TABLE "Trade" ADD COLUMN "exitOrderId" TEXT;
ALTER TABLE "Trade" ADD COLUMN "riskAmount" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN "baseGrade" TEXT;
ALTER TABLE "Trade" ADD COLUMN "equityBefore" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN "filledPrice" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN "filledQty" INTEGER;
ALTER TABLE "Trade" ADD COLUMN "exitPrice" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN "exitAt" TIMESTAMP(3);
ALTER TABLE "Trade" ADD COLUMN "exitReason" TEXT;
ALTER TABLE "Trade" ADD COLUMN "exitSignal" TEXT;
ALTER TABLE "Trade" ADD COLUMN "exitSignalAt" TIMESTAMP(3);
ALTER TABLE "Trade" ADD COLUMN "realizedPnl" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Trade" SET "broker" = 'ibkr' WHERE "conid" IS NOT NULL;

CREATE UNIQUE INDEX "Trade_clientOrderId_key" ON "Trade"("clientOrderId");
CREATE INDEX "Trade_mode_status_idx" ON "Trade"("mode", "status");

-- CreateTable
CREATE TABLE "BreakoutSignal" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "agentDecision" TEXT NOT NULL,
    "shouldAlert" BOOLEAN NOT NULL DEFAULT false,
    "resistance" DOUBLE PRECISION NOT NULL,
    "support" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "BreakoutSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB NOT NULL,
    "shouldAlert" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "signalsFound" INTEGER NOT NULL DEFAULT 0,
    "alertsSent" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "duration" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "breakoutSignalId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "conid" TEXT NOT NULL,
    "orderId" TEXT,
    "side" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "stopLossPrice" DOUBLE PRECISION NOT NULL,
    "positionValue" DOUBLE PRECISION NOT NULL,
    "maxPositionSize" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "accountId" TEXT NOT NULL,
    "cashBefore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" TIMESTAMP(3),

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BreakoutSignal_asset_createdAt_idx" ON "BreakoutSignal"("asset", "createdAt");

-- CreateIndex
CREATE INDEX "BreakoutSignal_shouldAlert_createdAt_idx" ON "BreakoutSignal"("shouldAlert", "createdAt");

-- CreateIndex
CREATE INDEX "Signal_agentName_asset_idx" ON "Signal"("agentName", "asset");

-- CreateIndex
CREATE INDEX "Signal_shouldAlert_createdAt_idx" ON "Signal"("shouldAlert", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentName_completedAt_idx" ON "AgentRun"("agentName", "completedAt");

-- CreateIndex
CREATE INDEX "Trade_asset_createdAt_idx" ON "Trade"("asset", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_status_createdAt_idx" ON "Trade"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_breakoutSignalId_idx" ON "Trade"("breakoutSignalId");

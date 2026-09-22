-- The reader's own trade book (hand-kept; distinct from the autotrader's Trade).
CREATE TABLE "BookTrade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL,
    "entry" DOUBLE PRECISION NOT NULL,
    "shares" DOUBLE PRECISION,
    "stop" DOUBLE PRECISION,
    "target" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3),
    "exit" DOUBLE PRECISION,
    "note" TEXT,
    "signalGrade" TEXT,
    "signalKind" TEXT,
    "signalPivot" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookTrade_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BookTrade_userId_status_idx" ON "BookTrade"("userId", "status");
CREATE INDEX "BookTrade_userId_openedAt_idx" ON "BookTrade"("userId", "openedAt");
ALTER TABLE "BookTrade" ADD CONSTRAINT "BookTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

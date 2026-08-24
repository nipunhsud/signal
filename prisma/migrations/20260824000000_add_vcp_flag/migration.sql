-- VCP mark on Type1 breakouts (Minervini Volatility Contraction Pattern):
-- base ATR% < 2.5, ATR(5)/ATR(20) < 0.75 contracting into the pivot, and the
-- breakout bar expanding >= 1.5x base ATR with a close in its top third.
ALTER TABLE "BreakoutSignal" ADD COLUMN "isVcp" BOOLEAN NOT NULL DEFAULT false;

-- VWAP per session, from FMP historical-price-eod/full (null for Yahoo-sourced bars)
ALTER TABLE "DailyBar" ADD COLUMN "vwap" DOUBLE PRECISION;

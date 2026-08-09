-- One-time backfill: freeze entryPrice + stopLoss on existing Type1/Type3 rows.
-- Semantics: for each asset, the earliest non-unknown row's resistance is the
-- true entry level for the active streak. Subsequent rows inherit the same
-- entryPrice, and stopLoss = entryPrice * 0.93 (7% below entry).
--
-- Rows with breakoutType='unknown' are left NULL — the dashboard filters those
-- out (confidence < 0.80), and going forward only Type1/Type3 rows are written.

WITH first_flip AS (
  SELECT DISTINCT ON (asset)
    asset,
    resistance AS entry_price
  FROM "BreakoutSignal"
  WHERE "breakoutType" != 'unknown'
  ORDER BY asset, "createdAt" ASC
)
UPDATE "BreakoutSignal" bs
SET
  "entryPrice" = ROUND(ff.entry_price::numeric, 2)::double precision,
  "stopLoss"   = ROUND((ff.entry_price * 0.93)::numeric, 2)::double precision
FROM first_flip ff
WHERE bs.asset = ff.asset
  AND bs."breakoutType" != 'unknown'
  AND bs."entryPrice" IS NULL;

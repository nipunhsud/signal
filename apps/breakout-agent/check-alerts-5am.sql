-- Check when alerts were actually sent
SELECT 
  asset,
  alertSentAt,
  to_char(alertSentAt AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI:SS ET') as et_time,
  to_char(alertSentAt AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS UTC') as utc_time,
  lastAlertPrice,
  currentPrice,
  ((currentPrice - lastAlertPrice) / lastAlertPrice * 100)::numeric(5,2) as price_change_pct
FROM "BreakoutSignal"
WHERE alertSentAt IS NOT NULL
ORDER BY alertSentAt DESC
LIMIT 20;

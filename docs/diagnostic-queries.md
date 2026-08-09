# Diagnostic Queries

Quick SQL snippets for investigating scan behavior. All examples assume the Docker Postgres container `signal-forge-db`. If querying from the host, replace the wrapper with `psql "$DATABASE_URL" -c "..."`.

## Signal & Alert Health

### Type 1 breakouts detected in the last 24h
```bash
docker exec signal-forge-db psql -U nipunsud -d signal_forge -c "
SELECT asset, ROUND(confidence::numeric * 100, 0) AS conf, \"pineScriptGreen\", \"shouldAlert\", \"alertSentAt\"
FROM \"BreakoutSignal\"
WHERE \"breakoutType\" = 'Type1'
  AND \"createdAt\" > NOW() - INTERVAL '24 hours'
ORDER BY confidence DESC
LIMIT 20;"
```

### Alerts actually sent in the last 24h
```bash
docker exec signal-forge-db psql -U nipunsud -d signal_forge -c "
SELECT asset, \"breakoutType\", ROUND(confidence::numeric * 100, 0) AS conf, \"alertSentAt\"
FROM \"BreakoutSignal\"
WHERE \"alertSentAt\" > NOW() - INTERVAL '24 hours'
ORDER BY \"alertSentAt\" DESC;"
```

### When did the last scan run, and how much did it produce?
```bash
docker exec signal-forge-db psql -U nipunsud -d signal_forge -c "
SELECT MAX(\"createdAt\") AS last_scan, COUNT(*) AS rows_today
FROM \"BreakoutSignal\"
WHERE \"createdAt\" > NOW() - INTERVAL '24 hours';"
```

## Earnings

### Recent Type 1/3 signals with their earnings snapshot
```bash
docker exec signal-forge-db psql -U nipunsud -d signal_forge -c "
SELECT asset, \"breakoutType\", ROUND(confidence::numeric * 100, 0) AS conf,
       \"earningsTone\", \"earningsToneScore\", \"earningsGuidance\",
       \"earningsQuarter\", \"earningsYear\"
FROM \"BreakoutSignal\"
WHERE \"earningsTone\" IS NOT NULL
  AND \"createdAt\" > NOW() - INTERVAL '24 hours'
ORDER BY \"earningsToneScore\" DESC NULLS LAST
LIMIT 20;"
```

### Latest transcript analysis per asset (the source cache)
```bash
docker exec signal-forge-db psql -U nipunsud -d signal_forge -c "
SELECT DISTINCT ON (asset) asset, quarter, year, tone, \"toneScore\", \"guidanceDirection\", \"createdAt\"
FROM \"TranscriptAnalysis\"
ORDER BY asset, year DESC, quarter DESC
LIMIT 30;"
```

## Common Reasons for Zero Type 1 Alerts

- Every candidate got downgraded to **Type 3** — the priorAlert-forces-Type-3 logic in
  [agent.ts:232-251](../apps/breakout-agent/src/agent.ts#L232-L251) reroutes any asset with an alert in the last 5 days
- No stock cleared the >90% confidence + green cone + `shouldAlert=true` bar
- Chop / no clean base breakouts on the day
- Scans didn't fire — check `docker-compose logs --tail=30 agent-tier-1` for cron errors or `Outside market hours` skips

## Container / Process Health

### Confirm scans are running in Docker (look for [LIVE] splice logs)
```bash
docker-compose logs --tail=50 agent-tier-1 | grep -E "LIVE|Starting.*scan|Alert"
```

### Confirm the earnings columns exist
```bash
docker exec signal-forge-db psql -U nipunsud -d signal_forge -c \
  "\d \"BreakoutSignal\"" | grep earnings
```

### Force a one-off scan without waiting for the cron tick
```bash
curl -X POST http://localhost:3000/api/scan
```

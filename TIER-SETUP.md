# Tier-Based Scanning (Without Docker)

Scan all 6,270 assets every hour using parallel tier agents.

## Quick Start

### 1. Verify tier config files exist

```bash
ls -la .env.tiers/ | wc -l
# Should show 100+ tier files
```

### 2. Update API keys in tier files

Each tier needs API keys. Update one template:

```bash
# Edit one file
nano .env.tiers/.env.tier-1

# Add your keys:
FMP_API_KEY=e5ccbcc74abe54698f96836dd4c51d48
GEMINI_API_KEY=AIzaSyB...
ALERT_EMAIL=your-email@gmail.com
```

Then copy to all tiers:

```bash
for i in {1..63}; do
  grep "FMP_API_KEY" .env.tiers/.env.tier-1 >> .env.tiers/.env.tier-$i
  grep "GEMINI_API_KEY" .env.tiers/.env.tier-1 >> .env.tiers/.env.tier-$i
  grep "ALERT_EMAIL" .env.tiers/.env.tier-1 >> .env.tiers/.env.tier-$i
done
```

### 3. Launch all tiers

```bash
cd apps/breakout-agent
./launch-tiers.sh 63
```

This launches 63 agents in parallel, each scanning ~100 assets/hour.

**Result:**

- 63 tiers × 100 assets = 6,300 assets scanned **per hour**
- All tiers run simultaneously
- All signals stored in same PostgreSQL database
- Dashboard at http://localhost:3000 shows all signals

### 4. Monitor

```bash
# View tier logs
tail -f logs/tier-1.log
tail -f logs/tier-2.log

# View all running agents
ps aux | grep 'node dist/index.js' | grep -v grep

# View signals
curl http://localhost:3000/api/signals | jq 'length'
```

## Coverage

| Tiers | Assets | Time   | Assets/Hour |
| ----- | ------ | ------ | ----------- |
| 1     | 100    | Hourly | 100         |
| 10    | 1,000  | Hourly | 1,000       |
| 63    | 6,300  | Hourly | 6,300       |

## How It Works

1. Each `.env.tier-N` file is configured to scan a specific tier
2. `launch-tiers.sh` starts each as a separate Node.js process
3. Each process runs its hourly cron independently
4. All write signals to the same database
5. Dashboard aggregates and displays all signals

## Customization

### Launch specific tiers only

```bash
# Only scan tiers 1-10
./launch-tiers.sh 10
```

### View logs for a specific tier

```bash
tail -f logs/tier-5.log
```

### Stop all agents

```bash
pkill -f 'node dist/index.js'
```

### Start/stop individual tier

```bash
# Stop one
kill $(pgrep -f 'ASSETS_TIER=5')

# Restart one
env $(cat .env.tiers/.env.tier-5 | xargs) node dist/index.js > logs/tier-5.log 2>&1 &
```

## Troubleshooting

### API errors in tier logs

```bash
# Check FMP API responses
grep "FMP\|financialmodeling" logs/tier-1.log

# Test API key manually
curl "https://financialmodelingprep.com/api/v3/historical-price-full/AAPL?apikey=YOUR_KEY" | jq '.[]' | head
```

### Database connection errors

```bash
# Check database is running
psql -U nipunsud -d signal_forge -c "SELECT COUNT(*) FROM \"BreakoutSignal\";"
```

### No signals appearing

```bash
# Check if agents are running
ps aux | grep 'node dist' | grep -v grep

# Check tier 1 log
tail -20 logs/tier-1.log

# Check if confidence calculations are working
tail -20 logs/tier-1.log | grep -i confidence
```

## Performance Notes

- **Database**: PostgreSQL can handle 6,300+ signals/hour easily
- **API rate limits**: FMP allows 250 requests/day (free tier). With 6,270 assets, that's ~4 days for one complete scan. Use a paid tier for continuous hourly scans.
- **Memory**: Each Node.js agent uses ~150MB. 63 agents = ~9GB total
- **Network**: Each agent makes ~100 API calls/hour

## Next: Docker

When you install Docker, you can switch to:

```bash
docker-compose up -d
```

Same functionality, cleaner management, easier to scale.

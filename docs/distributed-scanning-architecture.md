# Distributed Scanning Architecture

## Overview

Signal Forge uses a distributed architecture to scan thousands of stocks efficiently using FMP.io as the data source. Multiple agent containers run in parallel, each scanning a different tier of stocks on a hourly schedule.

---

## Components

### 1. **Breakout Agent Containers** (126 instances)
- Always running in the background
- Each container handles a specific tier of stocks
- Scans on a cron schedule (hourly by default)
- Uses FMP.io API for market data
- Saves detected signals to the database

### 2. **Database** (PostgreSQL)
- Central store for all signals detected by all 126 agents
- Shared by all containers and the dashboard

### 3. **Dashboard** (Separate process)
- Independent web UI
- Polls database every 5 seconds
- Displays signals from all 126 agents
- Does NOT spawn or control agents

---

## Execution Flow

### One-Time Setup
```bash
# Generate tier environment files (.env.tier-1 through .env.tier-126)
./scripts/generate-tier-envs.sh combined-nasdaq-nyse-sp500 50 126

# Spawn 126 containers (stay running continuously)
docker-compose up -d
```

### Hourly Scanning (Inside Each Container)
Each container runs this loop continuously:

1. **Wait** for cron schedule (`0 * * * *` = top of every hour)
2. **Load** stocks for its tier (e.g., tier-1 = stocks 1-50, tier-2 = stocks 51-100)
3. **Fetch** market data from FMP.io API
4. **Analyze** for breakout patterns
5. **Save** detected signals to database
6. **Sleep** until next hour
7. **Repeat**

### Dashboard Updates (Continuous)
```
Every 5 seconds:
  1. Fetch latest signals from database
  2. Re-render table
  3. Update stats (green/orange/yellow counts)
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│         126 Breakout Agent Containers                   │
│  (Always Running, Scanning Hourly via Cron)             │
│                                                         │
│  ┌──────────────┬──────────────┬─ ... ─┬──────────────┐ │
│  │ Container-1  │ Container-2  │       │Container-126 │ │
│  │ Tier 1       │ Tier 2       │       │ Tier 126     │ │
│  │ (1-50)       │ (51-100)     │       │ (6251-6270)  │ │
│  └──────────────┴──────────────┴─ ... ┴──────────────┘ │
│         ↓            ↓                      ↓           │
│    FMP.io API Calls (Parallel)             │           │
│         ↓            ↓                      ↓           │
└─────────────────────────────────────────────────────────┘
                        ↓
            ┌───────────────────────┐
            │   PostgreSQL Database │
            │   (All Signals)       │
            └───────────────────────┘
                        ↑
            ┌───────────────────────┐
            │  Dashboard            │
            │  (Separate Process)   │
            │  Polls every 5s       │
            └───────────────────────┘
                        ↑
            ┌───────────────────────┐
            │  Web Browser          │
            │  (Display Signals)    │
            └───────────────────────┘
```

---

## Key Points

### Containers Are NOT Spawned Hourly
- Containers are spawned **once** with `docker-compose up -d`
- They run **continuously** in the background
- Each container runs the scanning loop internally every hour

### Dashboard Is Independent
- Does NOT control or spawn agents
- Does NOT trigger scanning
- Simply displays signals already in the database

### Distributed Scanning Benefits
- **Parallel Processing**: All 126 containers scan simultaneously
- **Rate Limit Compliance**: Each container makes fewer API calls
- **Speed**: 6,270 stocks scanned in ~30 minutes (vs hours sequentially)
- **Fault Tolerance**: If one container fails, others continue

### Tier Structure
With `ASSETS_TIER_SIZE=50` and 6,270 stocks:
- **Total tiers needed**: 126 (6270 ÷ 50)
- **Stocks per tier**: 50
- **Tier example**: Tier-5 scans stocks 201-250

---

## Configuration

### Environment Variables
| Variable | Example | Purpose |
|----------|---------|---------|
| `ASSETS_FILE_PATH` | `./scripts/scanner-lists/combined-nasdaq-nyse-sp500.txt` | Stock list file |
| `ASSETS_MODE` | `tier` | Use tiered distribution |
| `ASSETS_TIER` | `1` | Which tier this container handles |
| `ASSETS_TIER_SIZE` | `50` | Stocks per tier |
| `CRON_SCHEDULE` | `0 * * * *` | Scan hourly |
| `DATA_SOURCE` | `fmp` | Use FMP.io for data |

### Generating Tier Environments
```bash
./scripts/generate-tier-envs.sh <list-name> <tier-size> <num-tiers>
```

Example:
```bash
./scripts/generate-tier-envs.sh combined-nasdaq-nyse-sp500 50 126
```

Creates:
- `.env.tier-1` (stocks 1-50)
- `.env.tier-2` (stocks 51-100)
- ... up to `.env.tier-126`

---

## Monitoring

### Check Container Status
```bash
docker-compose ps
```

### View Logs
```bash
docker-compose logs -f breakout-tier-1
docker-compose logs -f breakout-tier-2
# etc.
```

### Database Signals
```sql
SELECT COUNT(*) FROM breakout_signal;
SELECT DISTINCT asset FROM breakout_signal ORDER BY asset;
```

---

## Scaling

To scan fewer stocks (e.g., 1,000 instead of 6,270):
```bash
# Adjust tier size or count
./scripts/generate-tier-envs.sh combined-nasdaq-nyse-sp500 100 11
docker-compose up -d
```

To scan more stocks:
```bash
# Add more scanner lists to combined file
cat scripts/scanner-lists/other-*.txt >> scripts/scanner-lists/combined-nasdaq-nyse-sp500.txt

# Regenerate with more tiers
./scripts/generate-tier-envs.sh combined-nasdaq-nyse-sp500 50 200
docker-compose up -d
```
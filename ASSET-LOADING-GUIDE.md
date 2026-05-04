# Asset Loading Guide

Complete guide to managing asset lists for signal-forge scanning.

---

## Quick Start

### **1. Small Test (30 stocks)**
```bash
# .env
ASSETS_FILE_PATH=./scripts/scanner-lists/dow30-tradingview-import.txt
DATA_SOURCE=ibkr
```
✅ Done! Breakout agent will scan DOW 30 stocks hourly.

---

### **2. Medium (100 tech stocks)**
```bash
# .env
ASSETS_FILE_PATH=./scripts/scanner-lists/nasdaq100-tradingview-import.txt
ASSETS_MODE=subset
ASSETS_SUBSET_COUNT=50
DATA_SOURCE=ibkr
```
✅ Scans 50 random from top 100 NASDAQ stocks.

---

### **3. Large (All NYSE - 3,000 stocks)**

**Auto-generate 60 tier .env files:**
```bash
./scripts/generate-tier-envs.sh nyse 50 60
```

**Then run 60 instances (each with different tier):**
```bash
# Instance 1
TIER=1 npm run dev

# Instance 2 (in another terminal)
TIER=2 npm run dev

# ... repeat 60 times, or use Docker Compose
```

Each instance scans 50 different stocks → all 3,000 scanned in ~30 minutes.

---

## Available Lists

| Market | Filename | Count | Tiers (50 each) |
|--------|----------|-------|-----------------|
| **DOW 30** | `dow30-tradingview-import.txt` | 30 | 1 |
| **NASDAQ-100** | `nasdaq100-tradingview-import.txt` | 100 | 2 |
| **NASDAQ All** | `nasdaq-all-tradingview-import.txt` | ~3,400 | 68 |
| **NYSE All** | `nyse-all-tradingview-import.txt` | ~3,000 | 60 |
| **NSE 500** | `nse-500-tradingview-import.txt` | 500 | 10 |
| **BSE 100** | `bse-100-tradingview-import.txt` | 100 | 2 |

Full details: [`scripts/scanner-lists/ASSET-REGISTRY.md`](scripts/scanner-lists/ASSET-REGISTRY.md)

---

## Asset Loading Modes

### **Mode 1: Full List**
```bash
ASSETS_FILE_PATH=./scripts/scanner-lists/dow30-tradingview-import.txt
# ASSETS_MODE= (leave blank)
```
Loads all 30 stocks.

### **Mode 2: Tiered (Distributed)**
```bash
ASSETS_FILE_PATH=./scripts/scanner-lists/nyse-all-tradingview-import.txt
ASSETS_MODE=tier
ASSETS_TIER=1
ASSETS_TIER_SIZE=50
```
Loads stocks 1-50. Change `ASSETS_TIER=2` for stocks 51-100, etc.

### **Mode 3: Random Subset**
```bash
ASSETS_FILE_PATH=./scripts/scanner-lists/nasdaq-all-tradingview-import.txt
ASSETS_MODE=subset
ASSETS_SUBSET_COUNT=20
```
Loads 20 random stocks from NASDAQ.

### **Mode 4: Hardcoded List** (Still works)
```bash
SCAN_ASSETS=AAPL,MSFT,NVDA,GOOGL
# (ASSETS_FILE_PATH is ignored if this is set)
```

---

## Real-World Examples

### **Example 1: Scan DOW while testing with $95**
```bash
# .env
ASSETS_FILE_PATH=./scripts/scanner-lists/dow30-tradingview-import.txt
DATA_SOURCE=ibkr
CRON_SCHEDULE=0 * * * *

MAX_POSITION_SIZE=95
STOP_LOSS_PERCENT=0.02
TRADE_CRON_SCHEDULE=*/5 * * * *

IBKR_BASE_URL=https://localhost:5000
```

**Run:**
```bash
pnpm install
npm run build
cd apps/breakout-agent && npm run dev &
cd apps/trading-agent && npm run dev &
```

Every hour: scan 30 DOW stocks → detect breakouts → trade them with $95 max.

---

### **Example 2: Full NYSE scan with 10 instances**
```bash
# Generate 60 tier files
./scripts/generate-tier-envs.sh nyse 50 60

# Run 10 instances (each scans different 300 stocks)
for i in {1..10}; do
  TIER=$i npm run dev > logs/tier-$i.log 2>&1 &
done

# View logs
tail -f logs/tier-*.log
```

Result: 3,000 NYSE stocks scanned in ~30 minutes across 10 parallel instances.

---

### **Example 3: Docker Compose for 60 instances**

**`docker-compose.yml`:**
```yaml
version: '3'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: signal_forge
      POSTGRES_PASSWORD: signal123
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Generate with: ./scripts/generate-tier-envs.sh nyse 50 60
  breakout-tier-1:
    build: .
    env_file: .env.tiers/.env.tier-1
    depends_on:
      - postgres
      
  breakout-tier-2:
    build: .
    env_file: .env.tiers/.env.tier-2
    depends_on:
      - postgres
      
  # ... repeat for all 60 tiers

volumes:
  postgres_data:
```

**Run:**
```bash
./scripts/generate-tier-envs.sh nyse 50 60
docker-compose up -d
docker-compose logs -f
```

---

## How Asset Loading Works

1. **Read File** → TradingView format (`NYSE:AA,NYSE:AAMI,...`)
2. **Parse** → Strip exchange prefix (`AA,AAMI,...`)
3. **Mode**:
   - `full`: Return all symbols
   - `tier`: Slice by `(TIER-1) * TIER_SIZE` to `TIER * TIER_SIZE`
   - `subset`: Random sample of `SUBSET_COUNT` symbols
4. **Cache** → Store in memory (no re-reads per cycle)
5. **Use** → Pass to breakout analysis

---

## Updating Lists

Lists are static CSV files in `scripts/scanner-lists/`.

To refresh them:
```bash
# Update NASDAQ
python scripts/scanner-lists/fetch-nasdaq-list.py

# Update NYSE
python scripts/scanner-lists/fetch-nyse-list.py

# Update NSE (India)
python scripts/scanner-lists/fetch-nse-list.py
```

Or manually add symbols:
```bash
echo "NYSE:NEWSTOCK1,NYSE:NEWSTOCK2" >> scripts/scanner-lists/nyse-all-tradingview-import.txt
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ASSETS_FILE_PATH` | Path to scanner list file | `./scripts/scanner-lists/dow30-tradingview-import.txt` |
| `ASSETS_MODE` | Loading mode: `tier`, `subset`, or blank | `tier` |
| `ASSETS_TIER` | Tier number (1-60) | `1` |
| `ASSETS_TIER_SIZE` | Stocks per tier | `50` |
| `ASSETS_SUBSET_COUNT` | Stocks to randomly sample | `20` |
| `SCAN_ASSETS` | Fallback: comma-separated list | `AAPL,MSFT` |
| `DATA_SOURCE` | Market data source | `ibkr` |

---

## FAQ

**Q: Why use tiers instead of just scanning all at once?**
A: IB has rate limits (~1000 req/sec). Scanning 3,000 stocks at once would timeout. Tiers spread the load across multiple instances.

**Q: Can I modify asset lists?**
A: Yes! Just edit the `.txt` file. Format: `NYSE:AA,NYSE:AAMI,...`

**Q: What if I want a custom list?**
A: Create a new file in `scripts/scanner-lists/` with your symbols:
```
NYSE:AAPL,NYSE:MSFT,NASDAQ:GOOGL
```

**Q: How do I know which tier size to use?**
A: Start with 50. If you see timeouts, reduce to 25. If it completes too fast, increase to 100.

**Q: Can I use multiple asset sources?**
A: Yes, but only one at a time per agent instance. To scan multiple sources, run multiple instances with different `ASSETS_FILE_PATH`.

---

## See Also

- [`scripts/scanner-lists/ASSET-REGISTRY.md`](scripts/scanner-lists/ASSET-REGISTRY.md) — Detailed list descriptions
- [`.env.presets.md`](.env.presets.md) — Copy-paste configurations
- [IB Client Portal docs](https://www.interactivebrokers.com/en/software/cpapi/cpapi.htm) — API reference

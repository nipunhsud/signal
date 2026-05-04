# Asset Registry

Complete list of available scanner lists for signal-forge.

## US Markets

| Name | File | Count | Description |
|------|------|-------|-------------|
| **NYSE Full** | `nyse-all-tradingview-import.txt` | ~3,000 | All NYSE listed companies |
| **NASDAQ Full** | `nasdaq-all-tradingview-import.txt` | ~3,400 | All NASDAQ listed companies |
| **NASDAQ-100** | `nasdaq100-tradingview-import.txt` | 100 | Top 100 NASDAQ stocks |
| **DOW 30** | `dow30-tradingview-import.txt` | 30 | Dow Jones Industrial Average |

## Indian Markets

| Name | File | Count | Description |
|------|------|-------|-------------|
| **NSE 500** | `nse-500-tradingview-import.txt` | 500 | NSE top 500 stocks (India) |
| **BSE 100** | `bse-100-tradingview-import.txt` | 100 | BSE top 100 stocks (India) |
| **BSE Sensex 30** | `bse-sensex30-tradingview-import.txt` | 30 | BSE Sensex Index (India) |

---

## Usage

### In Code (breakout-agent)

**`.env`:**
```bash
# Scan top 100 tech stocks
ASSETS_FILE_PATH=./scripts/scanner-lists/nasdaq100-tradingview-import.txt
ASSETS_MODE=subset
ASSETS_SUBSET_COUNT=20

# OR scan NYSE in tiers (distribute across 60 instances)
ASSETS_FILE_PATH=./scripts/scanner-lists/nyse-all-tradingview-import.txt
ASSETS_MODE=tier
ASSETS_TIER=1
ASSETS_TIER_SIZE=50
```

### Tier Breakdown Examples

**NYSE (3,000 stocks → 50 per tier):**
- Tier 1: stocks 1-50
- Tier 2: stocks 51-100
- ...
- Tier 60: stocks 2,951-3,000

**NASDAQ (3,400 stocks → 100 per tier):**
```bash
ASSETS_TIER_SIZE=100
# Tier 1: 1-100, Tier 2: 101-200, ... Tier 34: 3,301-3,400
```

### Refreshing Lists

If you need updated lists, run the Python scripts:

```bash
# Update NASDAQ list
python scripts/scanner-lists/fetch-nasdaq-list.py

# Update NYSE list
python scripts/scanner-lists/fetch-nyse-list.py

# Update NSE list (India)
python scripts/scanner-lists/fetch-nse-list.py
```

---

## Recommended Configurations

### 1. **Small Test**
```bash
ASSETS_FILE_PATH=./scripts/scanner-lists/dow30-tradingview-import.txt
# Scans 30 blue-chip stocks (no tiering needed)
```

### 2. **Medium - Top Tech**
```bash
ASSETS_FILE_PATH=./scripts/scanner-lists/nasdaq100-tradingview-import.txt
ASSETS_MODE=subset
ASSETS_SUBSET_COUNT=50
# Scans 50 random from top 100 NASDAQ
```

### 3. **Large - Distributed NYSE**
```bash
ASSETS_FILE_PATH=./scripts/scanner-lists/nyse-all-tradingview-import.txt
ASSETS_MODE=tier
ASSETS_TIER=1
ASSETS_TIER_SIZE=50
# Run 60 instances with ASSETS_TIER=1..60
```

### 4. **International - India**
```bash
ASSETS_FILE_PATH=./scripts/scanner-lists/nse-500-tradingview-import.txt
ASSETS_MODE=tier
ASSETS_TIER=1
ASSETS_TIER_SIZE=50
# Run 10 instances for NSE 500
```

---

## File Format

All files are TradingView format (comma-separated, with exchange prefix):

```
NYSE:AA,NYSE:AAMI,NYSE:AAP,NYSE:AAT,...
```

The asset loader automatically strips the prefix:

```
AA,AAMI,AAP,AAT,...
```

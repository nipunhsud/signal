# How to Run Breakout Scanner on All Stocks

Use TradingView's **Pine Screener** to scan your watchlists and find stocks with breakout signals.

---

## Step 1: Add the Indicator to Favorites

1. Open **TradingView** → **Charts** (Supercharts)
2. Open **Pine Editor** (bottom panel) and paste the `breakout-scanner.pine` script
3. Click **Add to Chart**
4. **Right-click** the indicator name in the chart legend → **Add to Favorites** (star icon)

> **Important:** The indicator must be in your favorites to appear in the Pine Screener.

---

## Step 2: Create or Select a Watchlist

1. Go to **Products** → **Screeners** → **Pine**
2. In the left panel, select a **watchlist** to scan:
   - Use an existing watchlist (e.g., "All US Stocks", "S&P 500", "NASDAQ 100")
   - Or **import a pre-built list** (see [Bulk Import Watchlists](#bulk-import-watchlists) below)

---

## Bulk Import Watchlists

Pre-formatted lists for TradingView (format: `EXCHANGE:TICKER`, comma-separated):

| File | Stocks | Use Case |
|------|--------|----------|
| `dow30-tradingview-import.txt` | 30 | Dow Jones Industrial Average |
| `nasdaq100-tradingview-import.txt` | 101 | NASDAQ 100 (tech-heavy, liquid) |
| `nyse-sp500-tradingview-import.txt` | ~365 | NYSE stocks in S&P 500 (curated) |
| `nyse-all-tradingview-import.txt` | 1000 | All NYSE stocks, part 1 (TradingView limit) |
| `nyse-all-tradingview-import-2.txt` | 1000 | All NYSE stocks, part 2 |
| `nyse-all-tradingview-import-3.txt` | 146 | All NYSE stocks, part 3 |
| `nasdaq-all-tradingview-import.txt` | 1000 | All NASDAQ stocks, part 1 |
| `nasdaq-all-tradingview-import-2.txt` | 1000 | All NASDAQ stocks, part 2 |
| `nasdaq-all-tradingview-import-3.txt` | 1000 | All NASDAQ stocks, part 3 |
| `nasdaq-all-tradingview-import-4.txt` | 628 | All NASDAQ stocks, part 4 |
| `sp500-tradingview-import.txt` | ~500 | S&P 500 broad market |

**How to import:**
1. In TradingView, click the **watchlist** dropdown (e.g. "My List") → **Import list…**
2. Select the `.txt` file (or paste its contents)
3. Create a new watchlist or replace an existing one
4. Use it in the Pine Screener

> **TradingView limit:** Max 1,000 symbols per watchlist. For `nyse-all-*` (2,146) or `nasdaq-all-*` (3,628), import each file into a separate watchlist.

---

## Step 3: Select the Breakout Scanner

1. In the indicator dropdown (top of screener), select **"Breakout Scanner - Early or Confirmed"**
2. Set your **timeframe** (e.g., 5m for intraday, 1D for daily, 1W for weekly)
3. Click **Settings** (gear icon) on the indicator:
   - **Signal Mode** → **"Early (on touch)"** for real-time signals (fires when price breaks resistance, not on bar close)
   - **Require Volume (Early Mode)** → Off (recommended for intraday; bar may still be forming)

---

## Step 4: Set the Filter

1. Click **Add filter** (or use the filter toolbar)
2. Select **"Breakout Signal"**
3. Set condition: **equals** → **1**

This shows only symbols where the last bar triggered a breakout.

---

## Step 5: Run the Scan

1. Click **Scan**
2. Wait for the scan to complete
3. Results appear in the table—symbols with breakout signals

---

## Optional: Add More Filters

- **Good Structure** = 1 → Only stocks with bullish MA alignment
- **Breakout Signal** = 1 → Only confirmed breakouts (structure + volume + consolidation)

---

## 9:30 AM Intraday Workflow (5m Chart)

To get **real-time breakout signals** as the market opens (instead of waiting for bar close):

1. **Timeframe** → Set to **5m**
2. **Signal Mode** → **Early (on touch)**
3. **Require Volume (Early Mode)** → **Off** (bars are still forming at 9:30)
4. **Run Scan** at 9:30 AM (or any time during the session)
5. **Rescan every 5 minutes** to catch new breakouts as each 5m bar completes or as price breaks resistance mid-bar

> **Note:** TradingView's screener evaluates on the **last bar**. With Early mode on 5m, you'll see stocks where the current 5m bar has broken resistance. Rescan periodically to refresh results as new bars form and breakouts occur.

---

## Tips

| Tip | Description |
|-----|-------------|
| **Timeframe** | 5m for intraday (9:30 AM), 1D for swing trades, 1W for position trades |
| **Watchlist size** | Larger lists take longer to scan (500 bars per symbol) |
| **Rescan** | Click Rescan after changing watchlist, indicator, or filters. For 5m intraday, rescan every 5 min to catch new breakouts |
| **Sort** | Click column headers to sort by Breakout Signal, Good Structure, etc. |

---

## Limitations (TradingView)

- Only **one indicator** per scan
- **500 bars** max per symbol
- Supported timeframes: 1, 5, 15, 30 min; 1, 2, 4 hr; 1D, 1W, 1M
- One scan at a time per browser tab

# Getting All Indian Stocks for TradingView

## TradingView Limit

**Maximum 1,000 symbols per watchlist.** You cannot add all ~5,000+ BSE or ~2,000 NSE stocks to a single watchlist.

---

## Option 1: Use BSE Official Downloads (Up to 1,000)

BSE provides market-cap sorted lists:

1. Go to **https://www.bseindia.com/markets/Equity/EQReports/MarketwatchDownloads.aspx**
2. Download **"Top 1000 Companies"** or **"Top 500 Companies"** (Excel/CSV)
3. The file contains **Scrip Code** (numeric) and **Security Name**

**Problem:** TradingView needs `BSE:TICKER` format (e.g. `BSE:RELIANCE`), not numeric codes. The BSE download uses numeric codes, so you need a mapping.

---

## Option 2: Use NSE Instead (Easier)

NSE uses alphanumeric tickers (RELIANCE, INFY, TCS) which match TradingView. Format: `NSE:TICKER`

1. **NSE Bhav Copy** – Daily equity file with all NSE symbols
   - https://www.nseindia.com/all-reports
   - Look for "Bhav Copy" or "Equity" reports

2. **NSE List of Securities** – Full list of NSE stocks
   - https://www.nseindia.com/market-data/securities-available-for-trading

---

## Option 3: Third-Party Data Sources

| Source                           | What You Get         | Format             |
| -------------------------------- | -------------------- | ------------------ |
| **EODData.com**                  | NSE/BSE symbol lists | CSV (subscription) |
| **GitHub: NSE-India-All-Stocks** | NSE tickers          | CSV                |
| **IIFL Scrip Master**            | BSE+NSE mapping      | CSV (free)         |

---

## Option 4: Split Into Multiple Watchlists

Since the limit is 1,000 per watchlist:

- **Watchlist 1:** Top 1,000 by market cap (BSE or NSE)
- **Watchlist 2:** Next 1,000 (if you need more)
- Use different watchlists for different scans

---

## Conversion: BSE Code → TradingView Ticker

BSE uses numeric codes (500325), TradingView uses tickers (RELIANCE). Many stocks use the same ticker on NSE and BSE. A mapping is needed.

**Workaround:** Use **NSE** instead of BSE for broad coverage—most liquid Indian stocks are on NSE with cleaner tickers.

---

## Quick Setup: NSE Top 1000

If you want the largest 1,000 Indian stocks:

1. Get NSE list from: https://www.nseindia.com/market-data/securities-available-for-trading
2. Sort by market cap
3. Take top 1,000 tickers
4. Format as: `NSE:RELIANCE,NSE:TCS,NSE:INFY,...`
5. Save as `.txt` and import

---

## Files in This Folder

| File                                  | Stocks | Exchange                |
| ------------------------------------- | ------ | ----------------------- |
| `nse-500-tradingview-import.txt`      | 1000   | NSE (full list, part 1) |
| `nse-500-tradingview-import-2.txt`    | 617    | NSE (full list, part 2) |
| `bse-sensex30-tradingview-import.txt` | 30     | BSE                     |
| `bse-100-tradingview-import.txt`      | ~120   | BSE                     |
| `sp500-tradingview-import.txt`        | ~500   | US (NYSE/NASDAQ)        |

To regenerate the NSE import files from the full symbol list: `python fetch-nse-list.py`

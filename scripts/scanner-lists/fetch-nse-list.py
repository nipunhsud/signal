#!/usr/bin/env python3
"""
Fetch all NSE-listed equity symbols and output TradingView import format.

Source: GitHub iAnalyticsGeek/Datasets all_stock_codes_nse.csv
Output: nse-500-tradingview-import.txt (and -2, -3 if needed; max 1000 per file)

Usage:
  python fetch-nse-list.py
"""

import csv
import re
import urllib.request

URL = "https://raw.githubusercontent.com/iAnalyticsGeek/Datasets/master/all_stock_codes_nse.csv"
MAX_PER_FILE = 1000  # TradingView watchlist limit


def is_valid_symbol(symbol: str) -> bool:
    """Filter to reasonable equity symbols."""
    s = (symbol or "").strip().upper()
    if len(s) < 2 or len(s) > 30:
        return False
    # Skip if looks like header or empty
    if not s or s in ("SYMBOL", "COMPANY_NAME", "YAHOO_SYMBOL"):
        return False
    # Allow letters, numbers, hyphen (e.g. BAJAJ-AUTO)
    if not re.match(r"^[A-Z0-9\-]+$", s):
        return False
    return True


def main():
    print("Fetching NSE list from GitHub...")
    with urllib.request.urlopen(URL, timeout=30) as resp:
        content = resp.read().decode("utf-8", errors="ignore")

    reader = csv.DictReader(content.splitlines())
    tickers = []
    for row in reader:
        # Column is 'Symbol' in the CSV
        symbol = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
        if symbol and is_valid_symbol(symbol):
            tickers.append(symbol)

    tickers = sorted(set(tickers))
    print(f"Found {len(tickers)} NSE symbols")

    base_path = "nse-500-tradingview-import"
    for i in range(0, len(tickers), MAX_PER_FILE):
        chunk = tickers[i : i + MAX_PER_FILE]
        path = (
            f"{base_path}.txt"
            if i == 0
            else f"{base_path}-{i // MAX_PER_FILE + 1}.txt"
        )
        output = ",".join(f"NSE:{t}" for t in chunk)
        with open(path, "w") as f:
            f.write(output)
        print(f"Wrote {len(chunk)} symbols to {path}")

    return 0


if __name__ == "__main__":
    exit(main())

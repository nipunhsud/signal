#!/usr/bin/env python3
"""
Fetch all NYSE-listed stocks and output TradingView import format.

Source: GitHub datasets/nyse-other-listings (from NASDAQ symbol directory)
Output: nyse-all-tradingview-import.txt (max 1000 per file due to TradingView limit)

Usage:
  python fetch-nyse-list.py
"""

import csv
import re
import urllib.request

URL = "https://raw.githubusercontent.com/datasets/nyse-other-listings/master/data/nyse-listed.csv"
MAX_PER_FILE = 1000  # TradingView watchlist limit


def is_common_stock(symbol: str, name: str) -> bool:
    """Exclude preferred, warrants, units, rights, notes."""
    symbol = symbol.strip()
    name = (name or "").lower()
    # Skip preferred ($), warrants (.W), units (.U), rights (.R)
    if "$" in symbol or symbol.endswith(".W") or symbol.endswith(".U") or symbol.endswith(".R"):
        return False
    # Skip if name suggests preferred, warrant, unit, note
    if any(x in name for x in ["preferred", "warrant", "depositary share", "note due", "fund "]):
        return False
    # Skip very short (likely partial)
    if len(symbol) < 2:
        return False
    # Skip symbols with dots (except .A, .B for class shares)
    if "." in symbol and not re.match(r"^[A-Z0-9]+\.(A|B)$", symbol, re.I):
        return False
    return True


def main():
    print("Fetching NYSE list...")
    with urllib.request.urlopen(URL, timeout=30) as resp:
        content = resp.read().decode("utf-8", errors="ignore")

    reader = csv.DictReader(content.splitlines())
    tickers = []
    for row in reader:
        symbol = row.get("ACT Symbol", "").strip()
        name = row.get("Company Name", "")
        if symbol and is_common_stock(symbol, name):
            tickers.append(symbol.upper())

    tickers = sorted(set(tickers))
    print(f"Found {len(tickers)} NYSE common stocks")

    # Split into files of 1000
    for i in range(0, len(tickers), MAX_PER_FILE):
        chunk = tickers[i : i + MAX_PER_FILE]
        path = (
            "nyse-all-tradingview-import.txt"
            if i == 0
            else f"nyse-all-tradingview-import-{i // MAX_PER_FILE + 1}.txt"
        )
        output = ",".join(f"NYSE:{t}" for t in chunk)
        with open(path, "w") as f:
            f.write(output)
        print(f"Wrote {len(chunk)} symbols to {path}")

    return 0


if __name__ == "__main__":
    exit(main())

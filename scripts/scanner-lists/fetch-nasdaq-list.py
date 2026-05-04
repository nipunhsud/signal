#!/usr/bin/env python3
"""
Fetch all NASDAQ-listed stocks and output TradingView import format.

Source: GitHub datasets/nasdaq-listings (from NASDAQ symbol directory)
Output: nasdaq-all-tradingview-import.txt (max 1000 per file due to TradingView limit)

Usage:
  python fetch-nasdaq-list.py
"""

import csv
import re
import urllib.request

URL = "https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed.csv"
MAX_PER_FILE = 1000  # TradingView watchlist limit


def is_common_stock(symbol: str, name: str) -> bool:
    """Exclude preferred, warrants, units, rights, ETFs, notes."""
    symbol = symbol.strip()
    name = (name or "").lower()
    # Skip preferred ($), warrants (.W), units (.U), rights (.R)
    if "$" in symbol or symbol.endswith(".W") or symbol.endswith(".U") or symbol.endswith(".R"):
        return False
    # Skip ETFs and funds
    if " etf" in name or "exchange-traded" in name or "etf " in name:
        return False
    # Skip if name suggests preferred, warrant, unit, note
    if any(x in name for x in ["preferred", "warrant", "depositary share", "note due", "senior notes"]):
        return False
    # Skip very short (likely partial)
    if len(symbol) < 2:
        return False
    # Skip symbols with dots (except .A, .B for class shares)
    if "." in symbol and not re.match(r"^[A-Z0-9]+\.(A|B)$", symbol, re.I):
        return False
    return True


def main():
    print("Fetching NASDAQ list...")
    with urllib.request.urlopen(URL, timeout=30) as resp:
        content = resp.read().decode("utf-8", errors="ignore")

    reader = csv.DictReader(content.splitlines())
    tickers = []
    for row in reader:
        symbol = row.get("Symbol", "").strip()
        name = row.get("Security Name", "")
        if symbol and is_common_stock(symbol, name):
            tickers.append(symbol.upper())

    tickers = sorted(set(tickers))
    print(f"Found {len(tickers)} NASDAQ common stocks")

    # Split into files of 1000
    for i in range(0, len(tickers), MAX_PER_FILE):
        chunk = tickers[i : i + MAX_PER_FILE]
        path = (
            "nasdaq-all-tradingview-import.txt"
            if i == 0
            else f"nasdaq-all-tradingview-import-{i // MAX_PER_FILE + 1}.txt"
        )
        output = ",".join(f"NASDAQ:{t}" for t in chunk)
        with open(path, "w") as f:
            f.write(output)
        print(f"Wrote {len(chunk)} symbols to {path}")

    return 0


if __name__ == "__main__":
    exit(main())

#!/usr/bin/env python3
"""
Convert BSE/NSE stock list to TradingView watchlist import format.

Input: CSV with columns containing ticker/symbol (e.g., 'Symbol', 'Ticker', 'Scrip', 'Security Id')
Output: .txt file with format EXCHANGE:TICKER,EXCHANGE:TICKER,...

Usage:
  python convert-to-tradingview.py input.csv output.txt --exchange NSE
  python convert-to-tradingview.py input.csv output.txt --exchange BSE

CSV should have a column with ticker symbols (RELIANCE, INFY, TCS, etc.)
If your CSV has BSE numeric codes only, you'll need a separate mapping file.
"""

import csv
import argparse
import re


def find_ticker_column(headers):
    """Find column that likely contains ticker symbols."""
    for col in headers:
        col_lower = col.lower()
        if any(x in col_lower for x in ['symbol', 'ticker', 'scrip', 'security id', 'securityid', 'code']):
            return col
    return headers[0] if headers else None


def is_valid_ticker(val):
    """Check if value looks like a ticker (alphanumeric, not purely numeric)."""
    if not val or not str(val).strip():
        return False
    s = str(val).strip().upper()
    # Skip headers, empty, very long
    if len(s) > 20 or len(s) < 2:
        return False
    # Skip if looks like company name (too many words)
    if s.count(' ') > 1:
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description='Convert CSV to TradingView import format')
    parser.add_argument('input', help='Input CSV file')
    parser.add_argument('output', help='Output .txt file')
    parser.add_argument('--exchange', default='BSE', choices=['BSE', 'NSE'], help='Exchange prefix')
    parser.add_argument('--column', help='Column name containing tickers (auto-detected if not set)')
    parser.add_argument('--max', type=int, default=1000, help='Max symbols (TradingView limit)')
    args = parser.parse_args()

    tickers = set()
    seen = set()

    with open(args.input, 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        col = args.column or find_ticker_column(headers)

        if not col or col not in headers:
            print(f"Error: Could not find ticker column. Headers: {headers}")
            print("Use --column COLUMN_NAME to specify.")
            return 1

        for row in reader:
            val = row.get(col, '')
            if not is_valid_ticker(val):
                continue
            ticker = str(val).strip().upper()
            # Normalize: remove .NS, .BO suffixes
            ticker = re.sub(r'\.(NS|BO|NSE|BSE)$', '', ticker, flags=re.I)
            if ticker in seen and len(ticker) <= 10:
                continue
            seen.add(ticker)
            tickers.add(ticker)
            if len(tickers) >= args.max:
                break

    # Sort for consistency
    sorted_tickers = sorted(tickers)
    output = ','.join(f"{args.exchange}:{t}" for t in sorted_tickers)

    with open(args.output, 'w') as f:
        f.write(output)

    print(f"Wrote {len(sorted_tickers)} symbols to {args.output}")
    print(f"Format: {args.exchange}:TICKER")
    return 0


if __name__ == '__main__':
    exit(main())

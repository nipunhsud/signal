# Idea: Intraday 5-Min Breakout Scanner

## Problem

Current breakout agent runs on **EOD daily bars** (`historical-price-eod/full`). A stock that breaks out at 10am ET isn't detected until tomorrow's pre-market scan, after FMP publishes the daily bar (~7pm ET). Same-day entries are impossible.

Example: MXL's June 22 breakout wasn't actionable until June 23 morning — by then the move was already extended.

## Proposed Architecture

**New app**: `apps/intraday-agent/` — parallel to `breakout-agent`, doesn't replace it.

### Watchlist (pre-filtered universe)
Pull from existing `Signal` table:
```sql
SELECT DISTINCT asset FROM "Signal"
WHERE "signalType" LIKE 'setup-%'
  AND confidence > 0.85
  AND "createdAt" > NOW() - INTERVAL '5 days';
```
~50–150 stocks already in valid Type 2 setup. Keeps FMP requests well under rate limits and pre-filters to stocks structurally positioned to break out.

### Data source
FMP `historical-chart/5min` endpoint. Pull last ~60 bars per symbol (covers the trading day plus opening-range context).

### Detection logic (mirrors `analyzeBreakout`, intraday-adjusted)
- **Resistance**: opening-range high (first 30 min, i.e. 9:30–10:00 ET) OR prior-day high — whichever is tighter.
- **Breakout**: close of 5-min bar > resistance.
- **Volume confirmation**: bar volume > 1.5x average of prior 12 bars (1 hour).
- **MA stack**: still computed from daily bars (cached from main agent) — intraday MAs are too noisy.
- **Confirmation**: require **2 consecutive 5-min closes above resistance** to suppress head-fakes.

### Schedule
- Cron `*/5 9-16 * * 1-5` America/New_York
- Skip first 5 min after open (9:30 bar is volatile, often a fake)
- Stop at 15:55 (avoid MOC noise)

### Storage
**Same table as daily signals** — no separate `IntradayBreakout`. Per the [signal-storage-redesign](signal-storage-redesign.md) proposal, all classifications go into `Structure` with a `timeframe` column (`"1D"` | `"5min"`). A breakout is a breakout regardless of bar interval; splitting tables would re-fragment queries. Dashboards filter by `timeframe` when they need to.

If the redesign hasn't shipped when intraday goes live, add `timeframe` + `barStartAt` columns to existing `BreakoutSignal` as an interim step.

### Alerting
- Type 1-only emails (same rule as daily agent)
- **Cooldown**: max one alert per stock per day to prevent re-firing on retests
- Link back to the daily setup signal that put it on the watchlist

## Main Tradeoff: Noise

Daily bars naturally filter chop. 5-min bars whipsaw constantly — many "breakouts" reverse by lunch. Mitigations baked in above (2-bar confirmation, opening-range exclusion, volume gate, daily MA stack still required), but expect roughly 30–40% false-positive rate vs. the daily agent's ~5–10%.

## Open Questions

- Live quote endpoint for current-bar updates, or wait for bar close every 5 min?
- Should opening-range breakouts (ORB at 10am) be a distinct signal type vs. all-day resistance breaks?
- Backfill: replay 30 days of 5-min data against the historical setup watchlist to validate hit rate before going live.

## Status

Idea only. Not implemented. Discussed 2026-06-29 after debugging why MXL's June 22 breakout wasn't actionable until the next morning.

# Autotrading

`apps/trading-agent` turns the breakout agent's **emailed graded breakouts**
into broker orders. Alpaca is the first broker (paper by default); the
`Broker` interface in `src/broker/types.ts` is the seam for IBKR later.

## The contract: trade what we emailed

The trader never re-derives a signal. A `BreakoutSignal` row is a candidate
only when all of these hold:

| Gate                                                         | Where it is enforced           |
| ------------------------------------------------------------ | ------------------------------ |
| Graded base S / A+ / A, closed above the X-ray pivot, liquid | breakout agent → `shouldAlert` |
| Market hours, one alert per base episode                     | breakout agent → `alertSentAt` |
| Alert younger than `TRADE_MAX_SIGNAL_AGE_HOURS` (24h)        | trader query                   |
| Grade in `TRADE_ALLOWED_GRADES`                              | trader query                   |
| Not yet handled (`executedAt` is null)                       | trader query                   |

Every candidate is then checked live: US symbol, tradable at the broker, live
price still **at or above the pivot and no more than 5 % past it** (the
dashboard's "fresh" band), not already held, under the open-position cap.
Terminal skips are written to `Trade` with `status = "skipped"` and the reason,
so the paper review can answer "what did we pass on, and was that right?".

## Orders

One order class, `oto` (one-triggers-other): a **market buy** that, on fill,
arms a **GTC stop-loss** at the signal's frozen `stopLoss` (7 % under the
pivot, matching the dashboard's stopped-out rule). Sizing is risk-first:

```
qty = min( equity × TRADE_RISK_PCT / (price − stop),   # 1 % of equity at risk
           equity × TRADE_MAX_POSITION_PCT / price,     # 20 % of equity per name
           cash / price )
```

## Operating point

`TRADE_PROFILE` is the one lever, from the sizing grid in
[exit-rules-study.md](exit-rules-study.md):

| Profile | Slots | Risk / trade | Exit | Backtest 1990–2026 |
| --- | --- | --- | --- | --- |
| `invested` (default) | 10 | 1 % | 20 % trail, every grade | ~9 %/yr · 38 % max DD · Sharpe 0.85 · ~2 trades/month |
| `conservative` | 5 | 1 % | 20 % trail, every grade | ~7 %/yr · 31 % max DD · ~1/3 in cash |

Any explicit `TRADE_*` variable overrides the profile's value, so
`TRADE_PROFILE=invested TRADE_MAX_OPEN_POSITIONS=8` is a valid middle.

## Selection and the market switch

- **Slots go to the strongest first.** Each cycle's candidates are ranked by
  the scanner's `rsRating` (6-month relative strength, 1–99), grade breaking
  ties, oldest alert last. `TRADE_RS_MIN` adds a floor (default 0: the study
  found the *order* matters, a floor alone does not).
- **Market switch.** `TRADE_REGIME_MA=200`: no new entries while SPY's latest
  close sits below its 200-day SMA, and with `TRADE_REGIME_EXIT=true`
  (default) the after-close review flags every open position `regime` so it
  is sold at the next open. The reading is cached per NY date in `RuntimeFlag`
  `trading_regime`. Below the MA the cycle log says `entries halted: market regime …`.
- Caveat on ranking: the simulation ranked a whole day's signals at the close;
  the live trader ranks whatever has alerted since the last cycle, so on a busy
  day early alerts still get first pick. Batching entries to once a day is a
  possible refinement.

## Sell rules

Measured over 97,789 graded breakouts in [exit-rules-study.md](exit-rules-study.md):

| Rule | Applies to | Mechanism |
| --- | --- | --- |
| 7 % hard stop | every position | GTC stop leg at the broker, armed when the entry fills |
| Close below the 50-day MA (`TRADE_MA_EXIT`) | grades not in `TRADE_TRAIL_GRADES` | after-close review flags the row (`exitSignal`); market sell at the next open |
| 20 % trailing stop from the peak high (`TRADE_TRAIL_PCT`, grades in `TRADE_TRAIL_GRADES`) | every grade by default | after-close review ratchets the broker stop up (`PATCH` order); replaces the MA rule |
| Market switch (`TRADE_REGIME_MA`, `TRADE_REGIME_EXIT`) | every position | SPY below its 200MA at the close → sold at the next open |
| One-year backstop (`TRADE_HOLD_DAYS`, 365) | every position | market sell if nothing else fired. Matches the study's 250-bar cap; a 90-day cap cost the trail rule 2.5 points of CAGR |

The **daily review** runs once per trading day after 16:05 ET (or on the
first cycle of the next day if the process was down), keyed by the
`RuntimeFlag` `trading_daily_review`. It pulls ~60 daily bars per open
position from Alpaca's data API (IEX feed) and does nothing until the
session's bar is published. No +20 % partial: the study showed it costs
~0.1 % per trade and adds nothing. Manual sells at the broker are still
recorded by the reconcile step with `exitReason = "manual"`.

## Lifecycle of a `Trade` row

```
submitted ──fill──▶ filled ──MA / time exit──▶ closing ──fill──▶ closed
    │                  └──stop / trail / manual sell─────────▶ closed
    ├──canceled / expired / rejected ──▶ canceled
    └──broker error ────────────────────▶ error
(skipped rows are created directly with quantity 0)
```

The row is written **before** the order goes out, keyed by
`clientOrderId = sf-<mode>-<signalId>`. A crash between the two leaves a
`submitted` row that the next cycle resolves by asking the broker for that
client id: found → fill state; not found → `error`. Nothing is ever ordered
twice for one signal.

## Safety rails (all evaluated every cycle)

- `TRADING_ENABLED` must be `true` or the process exits immediately.
- Live needs **both** `TRADING_MODE=live` and `TRADING_LIVE_CONFIRM=I_UNDERSTAND`,
  and refuses a paper URL. Paper refuses a live URL.
- **Kill switch:** `RuntimeFlag` key `trading_halted` = `"true"` stops new
  entries. Fills and exits keep reconciling. Flip it from psql:
  `INSERT INTO "RuntimeFlag" VALUES ('trading_halted','true',now()) ON CONFLICT (key) DO UPDATE SET value='true';`
- **Daily loss cap:** day-start equity is pinned in `RuntimeFlag`
  `trading_day_equity`; once equity is `TRADE_MAX_DAILY_LOSS_PCT` below it,
  no new entries until the next New York trading day.
- Position cap, per-trade risk cap, cash check, and the fresh-band check.
- Cycles never overlap; a slow broker call just delays the next tick.

## Running it

```bash
# 1. Paper keys from https://app.alpaca.markets (Paper Trading → API keys)
#    into root .env:
TRADING_ENABLED=true
TRADING_MODE=paper
ALPACA_API_KEY=...
ALPACA_API_SECRET=...

# 2. Migrate (adds the Trade lifecycle columns), then start the service
docker-compose up -d migrations && docker-compose up -d --build trader
docker-compose logs -f trader

# Local, against the same DB:
pnpm -F trading-agent build && TRADING_ENABLED=true node apps/trading-agent/dist/index.js
pnpm -F trading-agent test
```

Every cycle also writes an `AgentRun` row (`agentName = trading-agent:paper`),
so the dashboard's run history shows it alongside the scanners.

## Paper review queries

```sql
-- realized results by grade
SELECT "baseGrade", count(*) trades, sum("realizedPnl") pnl,
       avg(("exitPrice"-"filledPrice")/"filledPrice")*100 avg_pct,
       sum(case when "exitReason"='stop' then 1 else 0 end) stops
FROM "Trade" WHERE mode='paper' AND status='closed' GROUP BY 1;

-- what we skipped and why
SELECT asset, "baseGrade", "errorMessage", "createdAt"
FROM "Trade" WHERE mode='paper' AND status='skipped' ORDER BY "createdAt" DESC;
```

Compare `avg_pct` and the stop rate against the base-grade table in the
scanner (`S 62.6 % win / 11.6 % stop`, `A+ 57.7 / 22.6`, `A 54.8 / 32.1`).
The paper run does not re-validate the signal — that is what the 210k-breakout
study did — it validates **execution**: slippage on the market entry, how
often the fresh-band check rejects an emailed name, stop fills through gaps,
and whether the 30-day time exit leaves money on the table.

## Roadmap

1. **Phase 1 (this)** — Alpaca paper, env-configured, single account.
2. **Phase 2** — dashboard `/api/trades` + a positions panel; nightly summary
   email; run paper for 4–8 weeks and review with the queries above.
3. **Phase 3** — per-user `TradeSettings` (risk %, caps, allowed grades,
   ETF/market filters) replacing the env knobs; broker keys per user
   encrypted at rest. This is the "personalize trade" layer.
4. **Phase 4** — live: `TRADING_MODE=live` with small `TRADE_MAX_POSITION_PCT`,
   the kill switch wired to a dashboard button, and an IBKR adapter if wanted.

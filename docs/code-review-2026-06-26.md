# Signal Forge — Staff Engineer Code Review

**Date:** 2026-06-26
**Scope:** `apps/breakout-agent/` (full review), `prisma/schema.prisma`, `docker-compose.yml`, `apps/breakout-agent/server.js` (dashboard).
**LOC reviewed:** ~5,000 TypeScript + JavaScript.

Honest take: the system *works* and the trading logic is thoughtful, but it has accumulated the classic "shipped fast, never refactored" debt — a few real bugs, a lot of API-call wastage, and growing code-smell that will hurt in 6 months if not addressed.

---

## 🔴 P0 Bugs — fix soon

### 1. Rate limiter token cap is wrong → no burst capacity, slower than necessary
[apps/breakout-agent/src/tools/rate-limiter.ts:15-17](../apps/breakout-agent/src/tools/rate-limiter.ts#L15-L17)

```ts
this.tokens = Math.min(
  this.tokensPerSecond,    // ← caps at 2.33 (for 140/min), not at burst capacity
  this.tokens + elapsed * this.tokensPerSecond,
);
```

After any idle period, you can hold at most **2.33 tokens** even though the limit is "140/min". A proper token bucket caps at a burst size (typically `callsPerMinute` itself, so up to 140 burst). This silently slows every cold scan.

**Fix:**
```ts
const BURST = callsPerMinute;
this.tokens = Math.min(BURST, this.tokens + elapsed * this.tokensPerSecond);
```

### 2. Dead FMP call: `fetchETFProfile()` runs for every stock
[apps/breakout-agent/src/tools/market-data.ts:608](../apps/breakout-agent/src/tools/market-data.ts#L608) hits the `etf-info` endpoint for **every asset**, including stocks. With 3,500 stocks × 5 tiers × multiple scans/day = thousands of wasted API calls. The `assetType` is already authoritative from scan mode (`mode === "etfs" ? "etf" : "stock"`).

Estimated impact: **~50% reduction in FMP calls.** Single biggest perf win available.

### 3. Cached MarketData is mutated → subtle race
[apps/breakout-agent/src/agent.ts:246-250](../apps/breakout-agent/src/agent.ts#L246-L250)

```ts
if (priorAlert) {
  data.priorBaseDays = 0;          // ← mutates cached object
  data.priorBreakoutBarsAgo = 1;
  data.extensionPriorBreakoutBarsAgo = 1;
}
```

`data` came from `marketDataCache.get()` which returns the same object reference. The next call within the 5-min TTL gets the mutated version even without a prior alert. Classify-as-Type3 becomes sticky on cached re-reads.

**Fix:** clone before mutating, or pass these as separate inputs to `analyzeBreakout()`.

### 4. Race conditions on dedup + alert checks
The dedup patch and existing `priorAlert` check at [apps/breakout-agent/src/agent.ts:234](../apps/breakout-agent/src/agent.ts#L234) do `findFirst()` then `create()` with no transaction. Across 5 tier containers × 15 concurrent each = 75 concurrent workers. Two workers reading at the same moment can both pass "isUnchanged === false" and both insert duplicates. Same for alert sending — two workers could both fire emails.

**Fix:** Postgres unique constraint on `(asset, breakoutType, signalDate)` plus `db.breakoutSignal.upsert()`.

### 5. Cross-tier rate limit is not enforced
[apps/breakout-agent/src/agent.ts:167-169](../apps/breakout-agent/src/agent.ts#L167-L169) comment says "sum across tiers < 750/min" but nothing enforces this. Each tier has its own `globalRateLimiter`. Bursts can collectively exceed 750/min globally.

**Fix options:** Redis-backed rate limiter, reduce per-tier limit with safety margin, or accept 429s and retry (already partially done).

---

## 🟠 P1 Architecture issues

### 6. Two tables for one concept
- Type1/Type3 → `BreakoutSignal`
- Type2 → `Signal` (generic agent table)

This forces the dashboard SQL to UNION them and double-implements dedup. Should be **one signals table** with a `signalType` discriminator. Type 2 lives in a "flexible json metadata" column ([prisma/schema.prisma:83](../prisma/schema.prisma#L83)) — no indexes, no type safety, dashboard does `meta.currentPrice || 0` everywhere.

### 7. No transaction boundaries
Every DB write is standalone. A scan that crashes mid-asset leaves partial state. Wrap each `analyzeAsset` write block in `db.$transaction([...])`.

### 8. Two dashboard implementations fighting for port 3000
pm2 `breakout-dashboard` AND docker `signal-forge-dashboard`. Plus `dashboard.ts`, `dashboard-clean.ts`, and `server.js` files. Pick one — kill the rest.

### 9. Configuration sprawl
[apps/breakout-agent/src/config.ts](../apps/breakout-agent/src/config.ts) defines a `Config` shape but agent.ts/market-data.ts read `process.env.*` directly in 10+ places (`SHARD_INDEX`, `MIN_MARKET_CAP`, `MIN_VOLUME`, `MEGACAP_WATCH`, `RATE_LIMIT_PER_MIN`, `DYNAMIC_ASSETS`, `IMMEDIATE_SCAN`, `ANTHROPIC_MODEL`...). Centralize.

### 10. Magic numbers hardcoded throughout breakout-logic
[apps/breakout-agent/src/tools/breakout-logic.ts](../apps/breakout-agent/src/tools/breakout-logic.ts) has confidence formulas like `consolidationQuality -= (rangePercent - 5) / 100`, `confidence = Math.max(0.8, ...)`. These are tunable strategy parameters. Move to a single `STRATEGY_PARAMS` module for A/B testing.

### 11. Script proliferation
Top-level and in `apps/breakout-agent/`:
- `view-setups.ts` exists **twice** (root + app)
- `view-latest-signals.ts`, `view-signals.js`, `view-setup-signals.ts`, `monitor-signals.ts`, `dashboard.ts`, `dashboard-clean.ts`
- `backfill-sectors.js` AND `backfill-real-sectors.js`
- `update-etf-sectors.js`, `full-backtest-correct.js`

None wired into `pnpm` scripts. Audit → archive or commit to `scripts/oneoffs/`.

### 12. No tests at all
Zero `*.test.ts`, `*.spec.ts`, no `tests/`. For a system whose math determines whether you buy stocks, this is the highest-leverage thing missing. At minimum, golden tests for [breakout-logic.ts](../apps/breakout-agent/src/tools/breakout-logic.ts).

### 13. No structured logging or metrics
`console.log` with emojis everywhere. No request IDs, no scan IDs, no timing histograms, no API call counts. Pick pino/winston for structured logs + a simple `metrics.ts` module.

---

## 🟡 P2 Code quality

### 14. Pervasive `any` types
[market-data.ts](../apps/breakout-agent/src/tools/market-data.ts) is full of `allBars: any[]`, `b: any`. Define `interface Bar { date: string; open: number; ... }` once.

### 15. Errors swallowed silently
[market-data.ts:421-423](../apps/breakout-agent/src/tools/market-data.ts#L421-L423): `} catch { /* Not an ETF or endpoint failed */ }` — no log. Same at lines 567 and 594.

### 16. `getSectorTailwind()` editorial commentary in code
[agent.ts:42-56](../apps/breakout-agent/src/agent.ts#L42-L56). Narrative-style text that changes with market regime. Move to JSON.

### 17. Hardcoded ETF sector map of 30 tickers
[market-data.ts:621-653](../apps/breakout-agent/src/tools/market-data.ts#L621-L653). Thousands of ETFs scanned, only 30 mapped. Rest fall through to per-asset profile fetches.

### 18. No input validation on dashboard mutation endpoints
[server.js:312](../apps/breakout-agent/server.js#L312) `POST /api/removed-assets` takes `asset` from body with no validation, no auth. Add `zod` + shared-secret if port 3000 ever leaks beyond localhost.

### 19. `analyzeAsset` is 300+ lines
[agent.ts:202-516](../apps/breakout-agent/src/agent.ts#L202-L516). Break into:
- `computeSignal(data)` → returns analysis
- `persistBreakoutSignal(analysis)`
- `persistSetupSignal(analysis)`
- `enrichWithTranscript(analysis)`

### 20. Cache has no size bound
[cache.ts:7](../apps/breakout-agent/src/tools/cache.ts#L7) — Map without LRU. Only purged on `get`. Add `maxSize` and LRU.

### 21. Inconsistent file extensions
`.ts` and `.js` mixed at the same directory level in [apps/breakout-agent/](../apps/breakout-agent/). Commit to TS or migrate.

---

## 🟢 What's good

- **Monorepo layout is clean** — `apps/` and `packages/core/` separation is right
- **Trading logic is well-thought-out** — Type 1/2/3 classification with confidence decay is sophisticated
- **Sharding pattern** with 5 tier containers + `SHARD_INDEX` env vars is pragmatic
- **Cache + rate limiter** combo exists (even if the limiter has the bug above)
- **Prisma + Postgres** is the right choice
- **Delisting handling** ([delistings.ts](../apps/breakout-agent/src/tools/delistings.ts)) is conservative

---

## Suggested order of attack

Working from highest leverage:

1. **Fix the rate limiter bug** (#1) — 30 min, makes cold scans faster
2. **Skip `fetchETFProfile` for stocks** (#2) — 15 min, ~50% FMP call reduction
3. **Add unique constraint + upsert for dedup** (#4) — 1 hr, fixes race conditions properly
4. **Write golden tests for breakout-logic** (#12) — 1 day, enables safe refactoring forever
5. **Centralize config** (#9) — 2 hr, prevents future env var sprawl
6. **Extract STRATEGY_PARAMS constants** (#10) — 1 hr, makes strategy tuning a single-file change
7. **Pick one dashboard, delete the other** (#8) — 30 min
8. **Audit and archive one-off scripts** (#11) — 1 hr
9. **Merge BreakoutSignal + Signal tables** (#6) — 4 hr migration + dashboard updates

Roughly a week of work that would meaningfully change the trajectory of the codebase.

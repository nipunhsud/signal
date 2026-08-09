# Tech Doc: Signal Storage Redesign

## Status
Proposal. Discussed 2026-06-30.

## Problem

Current schema spreads signal data across two tables with inconsistent semantics:

| Table | Stores | Write rule |
|---|---|---|
| `BreakoutSignal` | Type 1 / Type 3 breakouts | Only if `isMeaningfulBreakout` AND `!isUnchanged` |
| `Signal` | Type 2 setups (`setup-base`, `setup-handle`) | Only if `isSetup` AND `!isSetupUnchanged` |

Concrete pains this caused:

1. **Can't answer "what is the system seeing for asset X right now?"** — requires UNION across two tables, plus per-table dedupe interpretation.
2. **No row ≠ not scanned.** PANW returned `unknown` on every scan → nothing written → indistinguishable from "agent crashed" or "FMP filtered it out." Wasted 30 min debugging this exact ambiguity.
3. **Scan history lost to dedupe.** If MXL holds Type 3 @ $96.60 across 8 scans, only one row exists. Loses signal that the system held conviction.
4. **Alerts mixed with structural state.** `shouldAlert` is a column on signal rows, but alerts are *events* (a moment we emailed) while signals are *current classifications*. Conflating them makes "list every alert sent this week" awkward and prevents tracking alert delivery state (sent? bounced? clicked?).
5. **Inconsistent metadata shape.** `BreakoutSignal` has flat columns (`resistance`, `support`, `barsInRange`, ...); `Signal` puts the same kind of data in a JSONB blob. Querying across them needs translation.

## Design Principle

**One entry per asset** for current state. **Structural snapshots** and **alerts** are independent append-only event streams that reference the asset.

This mirrors how the user thinks about it: "MXL is currently a Type 3 — when did we alert on it, and what did its structure look like at the time?"

## Proposed Schema

### 1. `Asset` — one row per symbol (current state)

```prisma
model Asset {
  symbol              String   @id
  assetType           String   // "stock" | "etf"
  sector              String?
  industry            String?

  // Latest scan result — overwritten each scan
  latestScanAt        DateTime?
  latestPrice         Float?
  latestSignalType    String?  // "Type1" | "Type3" | "setup-base" | "setup-handle" | "unknown"
  latestConfidence    Float?
  latestMaStack       Boolean?
  latestVolumeRatio   Float?

  // Universe membership
  isActive            Boolean  @default(true) // false = delisted / filtered
  isInUniverse        Boolean  @default(true) // passed FMP screener
  removedAt           DateTime?
  removedReason       String?

  // Relations
  structures          Structure[]
  alerts              Alert[]
  scans               ScanEvent[]

  @@index([latestSignalType, latestConfidence])
  @@index([isActive, isInUniverse])
}
```

One row per symbol. "What is MXL right now?" = single PK lookup. Dashboard list = `SELECT * FROM Asset WHERE latestSignalType IN (...) ORDER BY latestConfidence DESC`.

### 2. `Structure` — append-only structural snapshots

```prisma
model Structure {
  id                  String   @id @default(cuid())
  symbol              String
  capturedAt          DateTime @default(now())

  // Timeframe of the underlying bar data
  timeframe           String   // "1D" | "5min" | "1min"
  barStartAt          DateTime // start of the bar this classification is based on

  // Classification at this moment
  signalType          String   // includes "unknown" — every scan logs here
  confidence          Float

  // Structural state (was BreakoutSignal columns)
  resistance          Float
  support             Float
  price               Float
  ma20                Float?
  ma50                Float?
  ma150               Float?
  ma200               Float?
  maStack             Boolean
  volumeRatio         Float
  barsInRange         Int
  priorBaseDays       Int
  priorBaseRangePct   Float
  priorBreakoutBarsAgo Int
  extensionBarsAgo    Int
  pineScriptGreen     Boolean
  bullishCandle       Boolean

  // Earnings / macro context
  epsGrowthPct        Float?
  revenueGrowthPct    Float?
  epsBeat             Boolean?
  fedFundsRate        Float?

  // Free-form
  metadata            Json     // overflow for setup-specific fields, etc.

  asset               Asset    @relation(fields: [symbol], references: [symbol])

  @@index([symbol, timeframe, capturedAt])
  @@index([signalType, timeframe, capturedAt])
}
```

**Every scan writes one row** — including `unknown`. No dedupe at write time. Daily and intraday scans coexist in the same table; queries filter by `timeframe` when they care.
Storage estimate: 3,300 symbols × ~24 scans/day × ~200 bytes ≈ 16 MB/day → 6 GB/year. Acceptable; partition by month if needed.

For the dashboard, query the *latest* per symbol via the `Asset` table's denormalized `latestSignalType` — no `DISTINCT ON` needed on the hot path.

### 3. `Alert` — append-only alert events

```prisma
model Alert {
  id              String   @id @default(cuid())
  symbol          String
  firedAt         DateTime @default(now())

  signalType      String   // "Type1" only today; future-proof for Type 3 etc.
  confidence      Float

  // Snapshot of the structure that triggered the alert
  structureId     String?  // FK to the Structure row that caused the fire
  triggerPrice    Float
  resistance      Float
  stopLoss        Float?
  riskRewardRatio Float?

  // Delivery
  emailSent       Boolean  @default(false)
  emailSentAt     DateTime?
  emailError      String?

  asset           Asset    @relation(fields: [symbol], references: [symbol])

  @@index([symbol, firedAt])
  @@index([firedAt])
}
```

**Alerts are events, not state.** One row per fire. "All alerts this week" is a clean `WHERE firedAt > ...`. Email retry / delivery tracking has a real home.

Cooldown logic ("don't re-alert same asset within 24h") = `SELECT 1 FROM Alert WHERE symbol = ? AND firedAt > NOW() - INTERVAL '1 day'`.

### 4. `ScanEvent` — optional, ultra-light scan log

```prisma
model ScanEvent {
  id          String   @id @default(cuid())
  symbol      String
  scannedAt   DateTime @default(now())
  agentTier   Int
  status      String   // "ok" | "fmp_error" | "delisted" | "filtered" | "rate_limited"
  errorMsg    String?

  asset       Asset    @relation(fields: [symbol], references: [symbol])

  @@index([symbol, scannedAt])
  @@index([scannedAt, status])
}
```

Solves "was PANW even scanned?" cleanly. Skip if `Structure` row exists for the same `(symbol, capturedAt)` — they're redundant for successful scans. Most useful for tracking failures (FMP 429s, parse errors).

Could also be omitted in v1 — `Structure` already captures successful scans; failures could go to logs only. Decide based on debug needs.

## What Goes Away

- `BreakoutSignal` table → merged into `Structure`.
- `Signal` table → merged into `Structure`.
- `RemovedAsset` table → folded into `Asset` (`isActive`, `removedAt`, `removedReason`).
- `shouldAlert` columns → become a row in `Alert` instead.

## Query Examples (Before / After)

**"Current state of MXL"**
```sql
-- before
SELECT * FROM "BreakoutSignal" WHERE asset='MXL' ORDER BY "createdAt" DESC LIMIT 1
UNION ALL
SELECT * FROM "Signal" WHERE asset='MXL' ORDER BY "createdAt" DESC LIMIT 1;

-- after
SELECT * FROM "Asset" WHERE symbol = 'MXL';
```

**"Was PANW scanned in the last hour?"**
```sql
-- before: impossible to distinguish "scanned + unknown" from "not scanned"

-- after
SELECT COUNT(*) FROM "Structure"
WHERE symbol = 'PANW' AND "capturedAt" > NOW() - INTERVAL '1 hour';
```

**"All Type 1 alerts this week with their structure context"**
```sql
-- before: hand-stitch BreakoutSignal rows where shouldAlert=true
-- after
SELECT a.*, s.*
FROM "Alert" a JOIN "Structure" s ON s.id = a."structureId"
WHERE a."firedAt" > NOW() - INTERVAL '7 days';
```

## Migration Plan

1. **Add new tables alongside existing** (Prisma migration, non-destructive).
2. **Dual-write phase**: agent writes to both old and new schemas for ~1 week. Validate row counts and dashboard parity.
3. **Backfill**: one-shot script copies historical `BreakoutSignal` + `Signal` → `Structure`, derives `Asset` rows.
4. **Switch reads**: dashboard, view scripts, email logic all read from new tables.
5. **Drop old tables** after a buffer week.

Estimated effort: 1-2 days for schema + dual-write, half day for backfill script, half day to migrate dashboard reads. ~3 days total.

## Risks

- **Storage growth.** 16 MB/day is fine; if intraday 5-min scanner ships (`docs/ideas/intraday-5min-breakouts.md`), bumps to ~200 MB/day. Plan: monthly partition on `Structure.capturedAt`, drop partitions > 1 year old.
- **Dashboard regressions.** Mitigated by dual-write window — diff old vs new responses before cutover.
- **Backfill data loss.** Old `BreakoutSignal` rows don't have full MA values (only `resistance`/`support`); some `Structure` columns will be null for backfilled rows. Acceptable.

## Open Questions

- Keep `ScanEvent` or rely on `Structure` + logs? Lean toward dropping it for v1; add later if debugging needs it.
- Index strategy for `Structure` — `(symbol, capturedAt DESC)` is the hot path; consider BRIN on `capturedAt` for time-range scans.
- Do we need a `confidence` history view for charting "conviction over time"? Free with this schema; might be worth a materialized view.

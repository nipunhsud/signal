# AI Assistance for Breakout Signals

## Status
Feature 1 (Signal Review) shipped 2026-07-01. Features 2-4 are proposed.

## Context

The breakout agent's core scoring is **fully deterministic** — `analyzeBreakout` / `analyzeSetup` are rule-based. The only AI in the pipeline today is `transcript-analysis.ts`, which summarizes earnings calls for the Type 1 alert email.

The rules find ~50-100 candidates per day (across confidence bands); alerting cuts that to a handful. AI can add value at the decision moments — not on every scan.

## Guiding Principle

**AI reviews signals; it does not generate them.** Deterministic rules do the 79K/day heavy lifting. AI weighs in on the ~10–50/day interesting moments. This keeps costs bounded (~$0.20/day for all 4 features on Claude Haiku 4.5) and preserves signal reproducibility.

## Features

### 1. Signal Review (shipped)

**What**: Every Type 1 / Type 3 alert email includes a second-opinion review from Claude Haiku 4.5: a 1-10 rating, one-line "strength," one-line "watch for."

**Where**: [tools/ai-signal-review.ts](../../apps/breakout-agent/src/tools/ai-signal-review.ts), invoked from `sendAlert()` in [agent.ts](../../apps/breakout-agent/src/agent.ts).

**Gating**: `AI_ASSISTANCE=true` env flag. Fails open — if the AI call errors, the email still sends without the review section.

**Cost**: ~5-15 alerts/day × ~2K in / 200 out tokens = **~$0.05/day**.

**Prompt shape**: fed a compact context (asset, sector, price, resistance, support, volume, EPS/revenue growth, base metrics). Explicitly told the rule screen already passed — its job is second-opinion context, not gatekeeping.

### 2. Rank Tie-Breaker (proposed)

**What**: When multiple Type 1 candidates fire at similar confidence (e.g., today's 4 candidates all at exactly 0.80), rank them 1-N with reasoning. Highest-ranked gets an "AI TOP PICK" flag in the email.

**Where**: New tool `rank-candidates.ts`. Called once per market-hour batch, not per signal.

**Cost**: 1–3 calls/day × 3K in / 500 out = **~$0.015/day**.

**Value**: When 4 alerts fire simultaneously and you can only trade 1-2, the AI's ranking is real information. Today's rules can't distinguish them.

### 3. Pre-Alert News Veto (proposed)

**What**: Before sending a Type 1 email, AI checks recent news / catalysts for the asset. Vetoes the alert if there's a disqualifying event: earnings in the next 24h, pending M&A, regulatory action, extreme recent gap.

**Where**: New tool + news feed integration (FMP has a news endpoint, or a lightweight NewsAPI account).

**Cost**: 5–15 pre-alert checks/day × 2K in / 200 out = **~$0.05/day** (plus news feed ~$0-30/mo).

**Risk**: Veto adds a can-fail dependency to the alert path. Must fail open (if AI errors → alert still sends). Log every veto with reasoning for audit.

### 4. Intraday Head-Fake Check (proposed)

**What**: Once the [intraday 5-min scanner](intraday-5min-breakouts.md) ships, AI reviews each candidate breakout before firing. Filters obvious pumps, low-float squeezes, illiquid names.

**Where**: In the intraday agent's alert pipeline, mirrors #1 with a tighter prompt focused on intraday-specific risks.

**Cost**: 30–90 candidates/day × 1.5K in / 200 out = **~$0.10/day**.

**Value**: Intraday will produce more false positives than daily. AI filter here is the highest-leverage of the four features.

## Cost Summary

| Feature | Daily | Annual |
|---|---|---|
| 1. Signal Review | $0.05 | ~$18 |
| 2. Rank Tie-Breaker | $0.015 | ~$5 |
| 3. Pre-Alert Veto | $0.05 | ~$18 |
| 4. Intraday Head-Fake | $0.10 | ~$35 |
| **Total (all 4)** | **~$0.22** | **~$80** |

Upgrade features 3 & 4 to Sonnet 4.6 for tougher judgment calls: ~3× → still under $200/year total.

## Anti-Patterns to Avoid

- **Never** call AI on every scan. 3,300 stocks × 24 passes × 2K tokens = ~$150/day. Kills the economics.
- **Never** let AI gate structural signal detection. Rules are reproducible and free; AI is stochastic and paid.
- **Always** fail open — an AI outage should never suppress a real alert.
- **Always** log the AI output alongside the signal that triggered it. Needed for later evaluation ("were the 8/10 ratings actually better trades?").

## Open Questions

- Do we A/B log AI reviews for a month before trusting them? (Send both flagged/unflagged emails, compare hit rate.)
- Should the AI review be included in Type 3 emails or Type 1 only? (Currently: both, since Type 3 ≥ 0.95 alerts too.)
- Do we want a lightweight AI review on Type 2 setups on the dashboard, not just alerts? (Cost: ~$0.20/day for ~100 setups — still cheap.)

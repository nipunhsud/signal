# Market health gauge study (Sep 2026)

Does the market health score (0–100: trend 50, distribution days 25,
breadth 25; ≥70 risk-on, 45–69 caution, <45 risk-off) predict how graded
breakouts go? The gauge was built from O'Neil's market-call rules and had
never been tested against outcomes. Prompted by the Sep 2026 reading of 57
"caution" while the screen's June breakouts had done well.

## Method

`apps/breakout-agent/scripts/market-health-study.mjs` replays the gauge over
history from the study cache with the same formula as `computeMarketHealth`:
trend on the S&P 500 and Nasdaq (SPY is not in the cache; QQQ from 1999, the
indexes before), O'Neil distribution days over 25 sessions on each benchmark
(max of the two), breadth as the share of the cache universe up on the month
(15 pts) and the week (10 pts). Each of the 44,142 graded breakouts in
`accumulation-rows.json` (A+/A, 1985–2026) is joined to the gauge on its
breakout day. Outcomes as in the other studies: win = 20-bar return > 0,
stop = a 7% low within 20 bars, PF on 20-bar returns floored at −7%,
reach +20% = best close within 60 bars.

Caveats: breadth uses the whole cache universe, not the day's scanned
universe; the S&P index stands in for SPY.

## Findings

**The regime does not predict outcomes.**

| Regime on the breakout day | n | win | stop | reach +20% | PF |
|---|---|---|---|---|---|
| risk-on (≥70) | 11,509 | 55.5% | 25.3% | 12.5% | 1.80 |
| caution (45–69) | 25,514 | 55.3% | 28.1% | 14.3% | 1.80 |
| risk-off (<45) | 7,119 | 58.1% | 30.5% | 14.2% | 2.00 |

Score bands are not monotonic either (35–44 is the best band at PF 2.53;
85–100 the worst at 1.66). By decade the sign flips: risk-on won in the
1980s and 2000s, risk-off won in the 1990s and 2010s, nothing separated the
2020s.

**Only one component carries signal: the index under both averages.**

| Trend component | n | win | stop | mean 20-bar | PF |
|---|---|---|---|---|---|
| 0 (below 50-day and 200-day, 50-day falling) | 1,895 | 50.1% | 40.3% | −0.80% | 1.27 |
| 15–40 (recovering, one or two of three on) | 4,597 | 60–62% | 24–25% | +1.3 to +1.7% | 2.3–2.6 |
| 50 (everything on) | 27,534 | 54.3% | 28.2% | +0.53% | 1.70 |

Breakouts taken with the tape fully "on" are ordinary. Breakouts taken as
the tape turns back up are the best bucket. Breakouts taken with the index
under both averages are the only bad bucket. This is the 200-day switch the
exit study already adopted, seen from the entry side.

**Distribution days point the wrong way.** 0–1 days PF 1.28 (n=366); 2–3
days 1.96; 9+ days 2.14 with 16.7% reach +20%. Heavy selling days in the
index precede bigger breakout winners, not smaller ones — the same result
the exit study found when it tested the O'Neil cash rule.

**Breadth is flat.** Under 40% of the universe up on the month: PF 1.91.
Over 70%: 1.87. Nothing in between separates.

**The activity score works in every regime.** Score 5+ beats 0–2 on PF and
reach in risk-on (2.10 vs 1.73), caution (2.17 vs 1.73) and risk-off (2.28
vs 1.92). The tape of the stock matters; the composite of the tape does not.

**The last two years, month by month.** June 2026 read 64, "caution", while
its breakouts won 71% at 20 bars. December 2024 read 66 and its breakouts
won 15%. April 2025 read 9, "risk-off", and its breakouts won 68%. The
monthly gauge and the monthly outcome do not move together.

| Month | gauge | trend | dist. days | graded breakouts | win 20-bar |
|---|---|---|---|---|---|
| 2025-03 | 12 | 4 | 7.4 | 63 | 38% |
| 2025-04 | 9 | 0 | 5.8 | 40 | 68% |
| 2025-06 | 68 | 50 | 5.1 | 77 | 45% |
| 2026-01 | 61 | 47 | 6.0 | 265 | 68% |
| 2026-03 | 20 | 11 | 9.0 | 51 | 51% |
| 2026-06 | 64 | 49 | 5.4 | 56 | 71% |
| 2026-09 | 50 | 39 | 5.3 | — | — |

(Months after mid-June 2026 have no scored breakouts yet: the 60-bar window
has not closed.)

## What this means for the product

- The score as a number has no predictive standing and should not be
  presented as one. The Monday post and the pulse card say "fewer breakouts
  hold in this tape" at caution; the data does not support that sentence.
- The one thing to say, and gate on, is the trend state: index under both
  averages with the 50-day falling → breakouts have lost money on average;
  anything else → no measured effect. That is already the trader's switch.
- Distribution days and breadth stay as information, not as score. Their
  weights in the composite are what make the number wander.
- Recommended shape: replace the 0–100 score with a three-word tape reading
  from trend alone (under both averages / turning up / on), keep the
  distribution and breadth tiles as context, and rewrite the copy to the
  measured claim.

## Rerun

```
cd apps/breakout-agent
node --max-old-space-size=12000 scripts/market-health-study.mjs   # ~4 min; needs study-cache/accumulation-rows.json
```

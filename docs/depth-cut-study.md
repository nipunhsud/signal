# The 25% depth cut (Sep 2026)

Is the grade's depth rule excluding good setups? Prompted by AMD on
2026-09-21: blue-sky pivot, 11.2 weeks, resolved on 1.84x volume, RS 89,
confidence 89%, zero failed pokes, the quietest base of the nine on its
record — ungraded, and therefore never emailed, on 27.5% depth alone.

## Method

`apps/breakout-agent/scripts/depth-cut-study.mjs` over the study cache. Keeps
every base that passes the grade rules **except depth** — blue-sky pivot, 25+
bars, close above the 200-day on the breakout bar, 100k+ average volume — and
buckets the outcome by depth. `base-detect` discards bases deeper than 35%, so
25–35% is the whole of what the cut excludes. Entry is the breakout close; win
is a positive 20-bar return; stop is a 7% low within 20 bars; PF is gross gains
over gross losses with each trade floored at −7%; reach +20% is the best close
within 60 bars.

Pool: 52,925 blue-sky breakouts, 1985–2026.

## Findings

**Depth is a payoff dial, not a quality gate.** Every step deeper lowers the
win rate a little, raises the fail-level touch rate a lot, and raises the
payoff more.

| Depth | n | win | fail-level touch | reach +20% | PF |
|---|---|---|---|---|---|
| 0–10% | 14,431 | 58.1% | 18.3% | 7.1% | 1.78 |
| 10–15% | 13,490 | 56.3% | 28.1% | 14.1% | 1.80 |
| 15–20% | 9,697 | 54.1% | 34.1% | 18.2% | 1.83 |
| 20–25% | 6,700 | 52.6% | 38.5% | 21.6% | 1.99 |
| 25–30% | 4,789 | 53.0% | 40.9% | 24.0% | 2.00 |
| 30–35% | 3,818 | 53.1% | 41.1% | 25.2% | 2.19 |

**The band the cut drops has the better profit factor.**

| | n | win | fail-level touch | reach +20% | PF |
|---|---|---|---|---|---|
| kept, 25% or shallower | 44,434 | 55.9% | 27.8% | 13.9% | 1.84 |
| dropped, 25–35% | 8,491 | 53.0% | 41.0% | 24.5% | 2.08 |

It is the same trade the studies keep finding for relative strength, tape
activity and breakout volume: a little less often right, considerably more
right when it is right. Three points of win rate buy eleven points of reach.

**Inside the dropped band, the quality tells sort it sharply.**

| Slice of the 25–35% band | n | win | fail-level touch | reach +20% | PF |
|---|---|---|---|---|---|
| volume dry-up under 0.8 | 1,627 | 53.9% | 44.3% | 29.9% | 2.56 |
| breakout volume 2x+ | 2,848 | 53.0% | 47.6% | 30.9% | 2.49 |
| VCP shape | 766 | 53.4% | 38.0% | 24.4% | 2.30 |
| 8 weeks+ and volume 1.5x+ | 3,812 | 52.9% | 43.5% | 27.1% | 2.21 |
| **AMD's shape: 8wk+, VCP, dry-up under 0.8** | **428** | **55.4%** | **37.4%** | **22.9%** | **2.49** |
| volume under 1.2x | 3,037 | 53.0% | 34.9% | 18.7% | 1.77 |

**It holds in every decade.** The deep band beat the shallow one on profit
factor in all five: 2.82 vs 2.61 (1980s), 2.50 vs 2.19 (1990s), 1.96 vs 1.79
(2000s), 1.95 vs 1.75 (2010s), 2.07 vs 1.71 (2020s).

## What this means for the product

The cut is not protecting anyone from bad setups. It removes a cohort that
pays better and fails more often.

**Do not simply widen the grade to 35%.** Emailed names would go from a 27.8%
fail-level touch rate to 41%. On a product where a subscriber reads one name
at a time, that changes the felt experience more than the profit factor
justifies.

**The shape that fits the evidence** is a deep-base kind of its own, separate
from S/A+/A, alertable only with the tells that sort the band: 8 weeks or
longer, and either a volume dry-up under 0.8 or a breakout on 2x volume. That
slice ran a 2.49–2.56 profit factor against 1.84 for everything the cut keeps,
and it is where AMD sits. Its label has to carry the higher fail rate in
words, and the 20% trail matters more here than anywhere else, because the
payoff is in the tail.

That is a change to the breakout rules, so by the standing rule it reaches the
alert gate, the daily tease, the Saturday receipts, the backtest and the
screener in one change, or not at all. Not shipped here: this study is the
evidence for the decision, not the decision.

## Rerun

```
cd apps/breakout-agent
node --max-old-space-size=12000 scripts/depth-cut-study.mjs   # ~6 min
```

# Minervini rules study (Sep 2026)

What Mark Minervini repeats on X, tested against every graded breakout in the
full-history cache, and what changed in the scanner as a result.

## Source

292 posts from @markminervini (2013–2026), collected on 2026-09-13 through
X search scoped to his account across 24 topics (VCP, pivot, stop, volume,
trend template, base, breakout, earnings, extended, distribution, progressive
exposure, tight, moving average, pullback, risk, sell, 50-day, relative
strength, new highs, shakeout, follow-through, position size, correction,
handle, gap, leaders, cheat). Most of his feed is market commentary, mindset
and marketing; the mechanical claims that recur are:

1. **Trend template** (Stage 2 only). Close above the 150 and 200-day, 150
   above 200, 200-day rising for at least a month, 50 above 150 and 200, price
   at least 30% above the 52-week low, within 25% of the 52-week high, RS rank
   70 or better. "95% of every name I trade meets the trend template"; very
   long bases and recent IPOs are the stated exception.
2. **Relative strength.** "90% of my trades start with a RS rank of at least
   89." "I've never gone long a 33 RS in my life." Screen on RS 89+ within 20%
   of the 52-week high.
3. **New highs.** "A stock cannot make a huge move without making new highs."
4. **VCP / tight pivot.** The right side has to "shakeout and tighten enough
   to indicate supply had been absorbed"; a quick recovery up the right side
   is "technical time compression" into overhead supply.
5. **Gaps.** "It's risky to rush in and buy breakouts on a big gap up day
   after a high volume sell-off."
6. **Breadth.** Percent of stocks above their own 50-day diverging from the
   index is his recurring caution signal; distribution days after a
   follow-through day are a red flag.
7. **Risk.** Always a stop, 1.25% of equity per trade on average, 2.5% max,
   progressive exposure, sell into strength, never let a decent gain become a
   loss. (Exposure ladders and feedback sizing were already tested in the
   exit-rules study and did not survive; not retested here.)

## Method

`apps/breakout-agent/scripts/minervini-study.mjs` over the local study cache
(5,486 symbols, daily bars, 1985–2026, no network). Pass one computes a
cross-sectional RS percentile per date for every symbol (IBD-style: 40% last
quarter, 20% each of the three before) and the share of the universe above
its own 50 and 200-day. Pass two replays `base-detect.js`, keeps every
breakout that is graded A+ or A (blue-sky pivot, 25+ bars, 25% deep or less,
close above the 200-day, 100k+ average volume), and measures each rule.
Entry is the breakout close. Win is a positive 20-bar return, stop is a low
7% under entry within 20 bars, PF is gross gains over gross losses with each
trade floored at -7%, and "reach +20%" is the best close within 60 bars.
`scripts/minervini-agg.mjs` prints the tables below.

Pool: 44,475 graded breakouts. Baseline 55.9% win, 27.8% stop, PF 1.84,
13.9% reach +20%.

## Findings

**RS rank is the strongest thing he says, and it works the way he trades, not
the way a win-rate screener would want.** Every step up in RS lowers the win
rate a little and raises the stop rate a lot, but the size of the winners
rises faster. The profit factor climbs monotonically and the +20% rate goes
from one in twenty to two in five.

| RS percentile | n | win | stop | mean 60-bar | reach +20% | PF |
|---|---|---|---|---|---|---|
| 1–49 | 5,848 | 58.2% | 13.1% | 2.06% | 4.7% | 1.75 |
| 50–69 | 13,027 | 56.6% | 20.9% | 2.16% | 7.9% | 1.66 |
| 70–79 | 9,585 | 54.8% | 27.6% | 2.37% | 12.2% | 1.68 |
| 80–88 | 9,121 | 55.2% | 34.0% | 2.29% | 17.5% | 1.86 |
| 89–94 | 5,026 | 55.6% | 42.2% | 3.27% | 26.9% | 2.20 |
| 95–99 | 1,868 | 52.8% | 54.3% | 3.81% | 39.5% | 2.42 |

RS 80+ beats RS under 50 on PF in every decade (1980s 3.13 vs 2.84, 1990s
2.60 vs 1.91, 2000s 1.91 vs 1.85, 2010s 1.93 vs 1.58, 2020s 1.93 vs 1.64).
The product's own 3m/1m/1w score ranks the same way, slightly weaker.

**The trend template adds two real pieces on top of blue sky.** Within graded
bases the close is always above the 150-day and within 25% of the high, so
those criteria are already met. What matters:

| Rule | passes | fails |
|---|---|---|
| 200-day rising over a month | PF 1.85, +0.75% | PF 1.16, -0.25%, 7.1% reach +20% (n=690) |
| 30%+ above the 52-week low | PF 1.88, 16.4% reach +20% | PF 1.57, 3.1% reach +20% (n=8,616) |
| 50 above 150 | PF 1.86 | PF 1.52 |
| 150 above 200 | PF 1.86 | PF 1.62 |
| Full template (ex RS) | PF 1.90, 16.7% | PF 1.63, 6.6% |
| Full template and RS 89+ | PF 2.25, 30.7% reach +20%, 45.9% stop | |

**Tightness is a safety label, not a return label.** A 10-bar range under 3%
of the pivot wins 59.9% with a 9.3% stop rate, but only 2.6% of those reach
+20% and PF is 1.68. A range of 12% or more stops out 48.4% of the time and
reaches +20% 31.6% of the time, PF 2.21. His "low risk entry" claim is true;
the reward in a 20 to 60-bar window is not.

**Right-side speed cuts the same way.** Fast V-shaped right sides (over 1%
of depth per bar) stop out 41–44% of the time but reach +20% 24–28% of the
time, PF 1.98–2.30. Slow right sides are the safe, small-move bucket. The
"time compression" caution does not show up as worse outcomes for blue-sky
bases.

**Gaps.** Breakouts that gap 2–10% at the open are the best bucket (PF
2.23–2.25). Gaps over 10% are weaker (53% win, 42% stop) but still above the
pool on PF. Breakouts that open down and close above the pivot are the worst
bucket (52.7% win, PF 1.76). Nothing here justifies a gate.

**Close near the high of the bar** is slightly worse, not better (top 10% of
range PF 1.77 vs bottom half 2.06). Not a rule.

**Breadth adds nothing beyond the 200-day switch.** Only the extreme (under
30% of stocks above their 50-day) is bad, PF 1.55, and it overlaps SPX below
its 200-day (PF 1.53). With SPX above the 200-day, breakouts during weak
breadth (under 40%) ran PF 2.07. The exit study's conclusion stands.

**Volume** repeats the earlier finding: quiet breakouts win more often with
fewer stops, power breakouts have the higher mean and PF (2.12 vs 1.70).

## What changed

- `breakout-logic.ts` now computes `trendTemplate`, `ma200Rising`,
  `pctAbove52wLow` and `pivotTightPct`. A falling 200-day removes the grade
  (the only template rule strong enough to gate). The rest are labels.
- `market-data.ts` supplies the 52-week low and the 200-day as of 21 bars ago.
- `BreakoutSignal` gains `trendTemplate` and `pivotTightPct` (migration
  `20260913000000_trend_template`); the signals API and the drawer show them,
  and the alert reasoning line carries an RS tag (leader 89+, strong 80+,
  laggard under 50), the template verdict and the pivot range.
- The trader's default RS floor moved from 0 to 80 (`TRADE_RS_MIN`), matching
  the tested setup in the exit study and this study's PF curve.

Not adopted: tightness or gap gates, breadth as a switch, closing position,
right-side speed. Cheat and low-cheat entries were not tested; they need a
definition of the pre-pivot tight area that his posts do not give.

## Rerun

```
cd apps/breakout-agent
node --max-old-space-size=12000 scripts/minervini-study.mjs   # ~7 min, writes study-cache/minervini-rows.json
node scripts/minervini-agg.mjs
```

## Addendum: 20-day-high entry vs the base pivot (2026-09-13)

Prompted by DE, whose September 1 entry froze at the 20-day high ($660.70)
while the base pivot was $674.19. `scripts/donchian-vs-pivot.mjs` compares
the two entries causally: at every bar the base is the highest high of the
trailing 250 bars not yet closed above; eligible when 25+ bars old, 25% deep
or less so far, blue sky, above the 200-day, 100k+ volume. Nothing is
dropped after the fact (the base detector discards consolidations that later
fall 35%, which flatters early entries: a first pass through it showed the
20-day entry ahead, PF 2.14 vs 1.83, and that number is wrong).

| Entry | n | win | stop | mean 20 | mean 60 | reach +20% | PF |
|---|---|---|---|---|---|---|---|
| close above prior 20-day high, inside the base | 162,970 | 56.8% | 22.8% | 0.75% | 2.48% | 10.9% | 1.78 |
| first close above the base pivot | 24,699 | 56.3% | 27.1% | 0.87% | 2.66% | 14.1% | 1.91 |

The 20-day entry fires 6.6 times as often. 65% of those bases go on to
clear the pivot within 60 bars and those entries are excellent (72% win, PF
4.84); the other 35% never do and are toxic (27.5% win, PF 0.22, none reach
+20%). Nobody can tell the two apart at entry. The pivot entry has the higher
PF in four decades of five and ties the fifth. The base pivot is the correct
entry; the scanner should freeze it when a graded breakout fires even if a
20-day-high streak is already active.

## Addendum: gap retest (2026-09-13)

Prompted by DE's Aug 20 earnings gap, the Aug 27 pullback that held it, and
the Aug 31 turn. `scripts/gap-retest.mjs` tests the shape causally: a 4%+ gap
up that closes green on 1.5x volume above the 200-day; within 15 bars a
pullback of 2%+ on closes, at least two bars after the gap, whose lows stay
above the gap day's low; entry on the first close above the prior bar's high,
within 20 bars of the gap. (A looser intraday-low version fired on DE's Aug
21 dip and scored PF 3.13; measuring the pullback on closes puts DE's low on
Aug 27 and the trigger on Aug 28, and scores better on every metric.)

| Slice | n | win | stop | mean 60 | reach +20% | PF |
|---|---|---|---|---|---|---|
| all | 9,474 | 56.2% | 46.4% | 8.39% | 41.3% | 3.69 |
| inside a blue-sky base | 1,040 | 60.2% | 34.9% | 6.59% | 32.9% | 3.29 |
| pullback 7%+ before the turn | 4,067 | 55.8% | 57.6% | 12.25% | 54.2% | 4.86 |
| pivot close-above, reference | 24,699 | 56.3% | 27.1% | 2.66% | 14.1% | 1.91 |

PF above the pivot entry in every decade (2.78 to 4.78). A big-winner
pattern with a high fail rate, the same risk class as the episodic pivot.
Shipped as its own kind: `breakoutType` GR, entry the trigger close, fail
level 7% under, tracked on the dashboard (badge "Gap retest", palette filter,
Backtest tab type) and emailed only when `GAP_RETEST_ALERT=true`.

## Addendum: alert latency (2026-09-13)

Scans ran only inside market hours and the last one at 16:00 saw a pre-auction
quote, so a settled close over the pivot emailed the next afternoon (DE:
$676.08 close on Sep 1, email at 16:00 on Sep 2 at $698). Fixed with a
post-close pass (`POST_CLOSE_CRON`, 16:15 ET), an alert window that runs 45
minutes past the close, and a trigger that also accepts the last completed
session. Test: `test/alert-window.test.mjs`.

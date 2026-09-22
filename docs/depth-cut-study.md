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

## Addendum: power and tightness (2026-09-21)

Tightness going into the breakout was the obvious pairing to test next — a
deep base that coils before it resolves. It does the opposite of what it looks
like it should, inside this band and in the one the cut keeps.

| 25–35% deep, 10-bar range before the breakout | n | win | fail-level touch | reach +20% | PF |
|---|---|---|---|---|---|
| under 4% of the pivot | 539 | 57.9% | 14.1% | 6.3% | 1.79 |
| 4–6% | 1,273 | 55.3% | 24.9% | 12.1% | 1.74 |
| 6–8% | 1,471 | 54.0% | 32.0% | 15.4% | 1.71 |
| 8–12% | 2,374 | 51.6% | 42.9% | 23.5% | 1.78 |
| 12% or more | 2,834 | 51.8% | 56.4% | 39.1% | 2.58 |

Tight is safe and small; loose is dangerous and large. Crossed with volume the
best cell is power **and loose**, not power and tight:

| 25–35% deep | n | win | fail-level touch | reach +20% | PF |
|---|---|---|---|---|---|
| 2x volume, range under 6% | 463 | 57.9% | 23.8% | 13.2% | 1.98 |
| 2x volume, range 6–10% | 861 | 51.5% | 43.1% | 22.3% | 1.86 |
| 2x volume, range 10%+ | 1,524 | 52.4% | 57.3% | 41.1% | **2.92** |
| quiet volume, range under 6% | 835 | 55.2% | 19.3% | 8.0% | 1.58 |

So the rule that ships requires depth, length and power volume, and **no
tightness condition**. Adding one costs more than it earns: the same slice with
a sub-8% range runs 1.99 on 881 cases against 2.39 on 2,555 without it.

| Rule | n | win | fail-level touch | reach +20% | PF |
|---|---|---|---|---|---|
| graded baseline, 25% or shallower | 44,434 | 55.9% | 27.8% | 13.9% | 1.84 |
| **deep + 8wk+ + 2x volume (shipped)** | **2,555** | **53.5%** | **44.9%** | **28.4%** | **2.39** |
| the same plus a sub-8% range | 881 | 55.7% | 30.6% | 16.2% | 1.99 |
| the same plus a tight coil and dry base | 189 | 56.1% | 42.9% | 31.7% | 3.39 |

By decade the shipped rule ran 2.49, 3.34, 2.17, 2.40 and 2.18, beating the
graded baseline in four of five and tying the 1980s.

The tight-coil, dry-base version is the best cell in the study at 3.39, but on
189 cases in forty years — about five a year. It ships as a label on the alert,
not as a gate.

AMD, the name that prompted all of this, resolved on 1.84x volume and does not
qualify. The line stayed at 2x, which is the screen's existing definition of
power; moving it to 1.8x to admit one name would have cost 0.05 of profit
factor and all of the discipline.

## Addendum: what actually sorts the band (2026-09-21, second pass)

Prompted by INTC. Its April 2026 breakout was 25.3% deep over 52 bars, blue
sky, and ran **+112%** — and a bare 2x volume gate refused it on 1.83x. AMD
was refused the same way on 1.84x. Two names inside a week landing just under
the line is a reason to measure the line, not to move it.

**Sweeping the volume threshold shows a plateau, not a cliff.** Deep band,
8 weeks or longer:

| Volume | n | per year | fail-level touch | reach +20% | PF |
|---|---|---|---|---|---|
| any | 7,866 | 192 | 39.0% | 22.5% | 1.97 |
| 1.5x+ | 3,812 | 93 | 43.5% | 27.1% | 2.21 |
| 1.8x+ | 2,981 | 73 | 44.5% | 27.8% | 2.34 |
| 2.0x+ | 2,555 | 62 | 44.9% | 28.4% | 2.39 |
| 2.5x+ | 1,811 | 44 | 45.5% | 28.6% | 2.38 |
| 3.0x+ | 1,375 | 34 | 46.9% | 28.5% | 2.29 |

Everything from 1.8x to 2.5x is the same number. Volume earns its keep up to
about 1.5x and then stops discriminating.

**What does discriminate is how decisively the close clears the pivot.**

| Close vs the pivot | n | fail-level touch | reach +20% | mean 60-bar | PF |
|---|---|---|---|---|---|
| within 2% of it | 5,267 | 34.3% | 18.4% | +2.64% | 1.79 |
| 2–5% past | 1,442 | 46.1% | 28.5% | +4.39% | 2.11 |
| 5–10% past | 390 | 53.3% | 36.9% | +5.89% | **2.83** |
| 10%+ past | 143 | 60.1% | 37.1% | +4.47% | 2.75 |

A marginal clearance is the weak case; a decisive one is the whole edge. Both
refused names were decisive: INTC closed 8.3% through its pivot, AMD 5.3%.

**The pair beats either alone.**

| Rule | n | per year | win | fail-level touch | reach +20% | mean 60-bar | PF |
|---|---|---|---|---|---|---|---|
| 2.0x volume (first pass) | 2,555 | 62 | 53.5% | 44.9% | 28.4% | +4.05% | 2.39 |
| 2%+ clearance alone | 1,975 | 48 | 52.6% | 48.6% | 30.8% | +4.69% | 2.30 |
| **1.5x and 2%+ clearance** | **1,517** | **37** | **52.4%** | **50.0%** | **31.7%** | **+5.12%** | **2.42** |
| 1.5x and 3%+ clearance | 1,057 | 26 | 53.2% | 52.4% | 34.2% | +5.58% | 2.61 |
| the union of 2x or the pair | 2,858 | 70 | 53.0% | 45.6% | 28.6% | +4.16% | 2.32 |

The pair beat the bare 2x in three decades of five (3.41 vs 2.49 in the 1980s,
2.23 vs 2.17 in the 2000s, 2.45 vs 2.18 in the 2020s), tied the 1990s, and lost
the 2010s (2.08 vs 2.40). Taking the union of both rules is worse than either,
so it is a replacement, not an addition.

**It is a deep-band effect, not a factor mistaken for one.** The same pair
applied to the bases the grade keeps lifts the profit factor from 1.76 to 1.91.
In the deep band it lifts 1.76 to 2.42.

**The clearance curve has no turn.** I said 2% was where it turned. It is not:
with 1.5x volume the profit factor climbs the whole way, and so does the fail
rate, while the alert count collapses.

| Clearance floor | per year | fail-level touch | reach +20% | mean 60-bar | PF |
|---|---|---|---|---|---|
| any | 82 | 42.9% | 26.6% | +3.92% | 2.20 |
| 1% | 56 | 46.0% | 28.9% | +4.48% | 2.33 |
| 2% | 37 | 50.0% | 31.7% | +5.12% | 2.42 |
| **3%** | **26** | **52.4%** | **34.2%** | **+5.58%** | **2.61** |
| 4% | 18 | 53.7% | 36.7% | +5.47% | 2.78 |
| 5% | 12 | 55.7% | 37.2% | +5.83% | 2.78 |
| 8% | 6 | 59.6% | 38.7% | +6.56% | 3.05 |

There is no optimum in the profit factor, so the threshold is a choice about
cadence and sample. **3% is shipped.** It beat 2% in four decades of five (the
1980s exception is 29 cases), and it leaves about 26 alerts a year. At 5% there
are 12 a year and at 8% six, which is too thin to trust a live rule on.

**The entry is the close, not the pivot.** At a 3% floor the average qualifier
has already left its pivot by 6.6%, so the pivot is a level no reader could
get, and the study measures this kind from the breakout close. The agent
therefore freezes the close for a deep-base alert and sets the 7% fail level
under it. Every number above is net of paying up for the clearance, which is
the point: buying strength decisively beat buying the pivot cheaply. Graded
breakouts keep the pivot, because their close sits within a couple of percent
of it.

**Shipped rule, replacing the 2x gate:** 1.5x volume **and** a close at least
3% through the pivot, entered at that close. About 26 alerts a year against 62,
a 2.61 profit factor against 2.39, a 34.2% chance of a 20% run against 28.4%.
The price is a 52% fail-level touch rate against 45%, which the label states.

## What this means for the product

The cut is not protecting anyone from bad setups. It removes a cohort that
pays better and fails more often.

**Do not simply widen the grade to 35%.** Emailed names would go from a 27.8%
fail-level touch rate to 41%. On a product where a subscriber reads one name
at a time, that changes the felt experience more than the profit factor
justifies.

**Shipped** as a deep-base kind of its own, separate from S/A+/A: blue-sky
pivot, 25–35% deep, 8 weeks or longer, above a rising 200-day, emailed when the
close clears the pivot by 3% or more on 1.5x volume and entered at that close
(see the second addendum for why that pair, that threshold and that entry), with the standing RS 89 and confidence
80% floor on top. Its label carries the higher fail rate in words, and the 20%
trail matters more here than anywhere else because the payoff is in the tail.

Per the standing rule it reaches the alert gate, the daily tease, the Saturday
receipts and the pool, the backtest, the screener badge and filter, the drawer,
the dossier and the chat prompt in one change.

## Rerun

```
cd apps/breakout-agent
node --max-old-space-size=12000 scripts/depth-cut-study.mjs   # ~6 min
```

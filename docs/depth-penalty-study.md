# A penalty measured on the bases the grade already throws away

September 2026.

TWLO has been scanned 349 times in the last two years. Every scan graded it A.
On 23 September it carried RS 97 and ranked first of twelve in its sector. It
has produced one email, sent a day late at a price 8% past the pivot.

Three entries went by without one:

| Date | What happened | Emailed |
|---|---|---|
| 7 Aug | 238.48 pivot cleared at 241.28 on 4.22x volume, +24.9% | no row at all |
| 15 Sep | shelf at 243.98 inside the 258.35 base, 82 scans | no |
| 21 Sep | 258.35 pivot cleared at 266.06 on 1.64x volume | a day late, at 279.33 |

The 15 September and 21 September misses have one cause. TWLO's confidence sat
at 79 against an 80 gate:

```
0.99  base for a Type1 breakout
-0.196  a loose 24.6% ten-bar range   -> 0.794, floored at 0.80
+0.04   blue sky                      -> 0.84
-0.05   the base is 10-20% deep       -> 0.79
```

One point. The last line is the subject of this study.

## Where the penalty came from

It cites a 2,074-base study: 10-20% deep is the worst pocket, 39.3% positive,
"shallower is safe, deeper is boom-or-bust, this middle band is just bad."

That finding is real. It was measured across every base, before the graded-base
rules existed. The penalty is now subtracted after the grade has been applied,
from the bases that survived it.

## Re-measured, split by whether the base grades

200,212 breakouts, 1985 to date, every base the detector resolves with 100k
average volume. Graded means the rules the screen actually uses: blue-sky
pivot, depth at or under 25%, close above a rising 200-day. Entry is the
breakout close, a fail is a 7% touch inside 20 bars, profit factor floors each
loss at −7%.

| | n | positive | touched fail | reached +20% | PF |
|---|---|---|---|---|---|
| **ungraded**, 10-20% deep | 29,941 | 21.9% | 78.2% | 14.9% | **0.52** |
| **ungraded**, everything else | 73,391 | 35.4% | 67.7% | 26.6% | 6.05 |
| **graded**, 10-20% deep | 34,703 | 54.2% | 37.4% | 21.2% | **1.96** |
| **graded**, everything else | 62,177 | 55.4% | 26.9% | 12.9% | 1.79 |

In the ungraded population the band is a disaster, exactly as the original
study found. In the graded population, where the penalty is applied, it is the
better half.

Finer, inside the grade:

| Depth | n | positive | touched fail | reached +20% | PF |
|---|---|---|---|---|---|
| 0 to 5% | 19,197 | 56.6% | 17.2% | 5.9% | 1.58 |
| 5 to 10% | 34,756 | 55.4% | 28.5% | 13.7% | 1.75 |
| 10 to 15% | 21,849 | 54.8% | 35.8% | 20.2% | 1.91 |
| 15 to 20% | 12,854 | 53.2% | 40.2% | 23.1% | 2.03 |
| 20 to 25% | 8,224 | 52.3% | 42.6% | 25.7% | 2.24 |

Profit factor rises monotonically with depth across the whole graded band. The
win rate falls, which is what the original study saw and what the penalty was
built on, and the payoff more than compensates. A penalty on the middle of that
range had the sign backwards.

This is the same mistake as the 25% depth cut, which was found in September to
be dropping the better cohort. Depth is priced once, by the grade.

## The change

The 0.05 deduction for a 10-20% deep base is removed. Nothing else moves. Blue
sky keeps its 0.04, the long-base bonus keeps its 0.04, and a loose
consolidation still costs what it cost.

TWLO's 21 September breakout scores 84 instead of 79.

## What it opens

Five names on the screen the day this was written sat between 75 and 79
confidence with RS 89 or better, against 65 already passing. Every one of the
five was in the 10-20% band:

| | RS | confidence | depth | sector rank |
|---|---|---|---|---|
| DELL | 94 | 79 | 17.9% | 1 of 12 |
| CLMT | 97 | 79 | 12.9% | 2 of 12 |
| OMER | 98 | 79 | 15.7% | 4 of 12 |
| TWLO | 97 | 76 | 16.5% | 1 of 12 |
| IOVA | 99 | 75 | 18.2% | 4 of 12 |

Sixty-five becomes seventy. That every near-miss on the board sat in one band
is what the penalty was doing.

## Not fixed here

7 August. The detector, run on TWLO's real bars, returns a resolved grade-A
base that day: blue sky, 24.9% deep, above a rising 200-day, closing above the
20-bar high on 4.22x volume. The live screen holds no row for that date at all,
and no episode covers 20 July to 18 August. Depth is not the cause, since a
24.9% base was never penalised. This looks like the scan-coverage gap seen on
22 September, when 180 of 455 names got no post-close scan.

Script: `scripts/depth-penalty-study.mjs`.

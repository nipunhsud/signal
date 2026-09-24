# Confidence does not survive being measured

September 2026.

TWLO sat at confidence 79 against an 80 gate with RS 97 and its sector ranked
first of twelve, and went unemailed through three entries. That prompted the
obvious question: does confidence separate outcomes at all, and if not, what
should hold that half of the gate?

The email gate was `rsRating >= 89 && confidence >= 0.80`.

## What confidence is

For a Type1 breakout, breakout-logic builds it from the five bars before the
breakout bar:

```
q = 0.99
q -= (consolidationRangePercent - 5)/100    when the five-bar range exceeds 5%
q -= (consolidationVolumePercent - 100)/100 when their volume exceeds the 20-bar average
q = max(0.80, q)
q += 0.04   blue sky
q += 0.04   base of 80 days or more
q += 0.03   VCP and staircase together
```

Anything that is not a Type1 scores 0.10.

## Method

The formula above, replicated exactly, over every graded breakout the detector
resolves from 1985 to date: blue-sky pivot, depth at or under 25%, close above
a rising 200-day, 100k average volume. 97,563 breakouts across 4,844 symbols.

RS is rebuilt the way the product builds it. The score is 0.5 times the
three-month return plus 0.3 times the one-month plus 0.2 times the one-week,
and the rating is that score's percentile against every symbol trading the same
session, taken fresh on each of 10,833 breakout sessions.

Entry is the breakout close, a win is a positive 20-bar return, a fail is a 7%
touch inside 20 bars, profit factor floors each loss at −7%, and reach is a
close 20% above entry inside 60 bars. Baseline for the pool: 54.9% positive,
30.7% fail touches, 16.0% reach, profit factor 1.87.

## Three findings, in order of how much they matter

### It is not a score gate at all

A graded base is blue sky by definition. The consolidation term floors at 0.80
and blue sky adds 0.04, so no graded breakout can score below 0.84.

Zero of 97,563 scored below 0.80.

Every graded breakout that reaches the gate passes the confidence half of it on
the number. The `&& confidence >= 0.80` clause was doing nothing.

### What it actually gated was the Type1 shape

A breakout that does not match Type1 scores 0.10 and is refused. That is not a
small exception:

| | n | positive | fail touch | reach | PF |
|---|---|---|---|---|---|
| graded breakouts that classify Type1 | 21,799 | 55.0% | 33.3% | 18.9% | 2.02 |
| graded breakouts that do not | 75,764 | 54.9% | 29.9% | 15.1% | 1.83 |

78% of the population was silenced. Inside the RS 89+ leaders, where it
mattered:

| | n | PF |
|---|---|---|
| RS 89+, Type1 | 6,337 | 2.30 |
| RS 89+, refused for not being Type1 | 17,965 | 2.15 |

Nearly three times as many breakouts were thrown away to gain 0.15 of profit
factor, and the discarded pile still ran far above the 1.87 baseline.

### Where the number varies, it runs backwards

| Confidence | n | positive | fail touch | reach | PF |
|---|---|---|---|---|---|
| 0.84 to 0.86 | 16,288 | 55.8% | 32.8% | 19.3% | 2.04 |
| 0.86 to 0.88 | 1,686 | 55.3% | 35.8% | 20.0% | 2.17 |
| 0.88 to 0.92 | 7,386 | 56.0% | 30.5% | 16.5% | 2.19 |
| 0.92 to 0.96 | 6,477 | 54.1% | 38.6% | 21.7% | 2.10 |
| 0.96 and up | 65,726 | 54.7% | 29.3% | 14.4% | 1.76 |

The highest-confidence bucket is the worst, and it holds two thirds of the
pool. The cause is the largest term in the formula. It subtracts for a loose
five-bar range, and a loose range measured better:

| Five-bar range | n | positive | fail touch | reach | PF |
|---|---|---|---|---|---|
| 0 to 4% | 36,748 | 57.0% | 17.8% | 7.3% | 1.70 |
| 4 to 6% | 26,288 | 55.0% | 30.0% | 14.0% | 1.73 |
| 6 to 9% | 19,860 | 53.0% | 39.2% | 21.6% | 1.83 |
| 9 to 14% | 10,785 | 52.1% | 49.9% | 30.8% | 2.14 |
| 14% and up | 3,882 | 52.7% | 60.6% | 42.2% | 3.02 |

The same inversion the depth-cut study found in the deep band, and the same
shape as every other tightness result here: tight bases hold more often and pay
much less. The 80-day bonus is backwards too, though barely: 1.82 against 1.88.
The five-bar volume term is the only piece pointing the right way, and it is
worth little.

## What holds up instead

**RS.** Monotonic where the gate sits, and steep.

| RS | n | positive | fail touch | reach | PF |
|---|---|---|---|---|---|
| under 50 | 6,330 | 59.4% | 14.1% | 5.6% | 1.89 |
| 50 to 70 | 22,717 | 56.5% | 20.2% | 8.1% | 1.70 |
| 70 to 80 | 20,826 | 55.4% | 25.9% | 11.5% | 1.70 |
| 80 to 89 | 23,388 | 54.0% | 32.9% | 16.6% | 1.74 |
| 89 to 95 | 15,920 | 53.5% | 42.3% | 25.2% | 2.04 |
| 95 to 99 | 8,382 | 51.6% | 55.5% | 37.4% | 2.45 |

**The breakout bar's own volume**, which confidence never looks at. It reads
the five bars before the breakout, not the one that cleared the level.

| Breakout volume | n | fail touch | reach | PF |
|---|---|---|---|---|
| under 1.2x | 48,970 | 27.8% | 13.2% | 1.73 |
| 1.2 to 1.5x | 16,113 | 30.9% | 15.3% | 1.80 |
| 1.5 to 2x | 14,113 | 33.2% | 18.2% | 1.92 |
| 2 to 3x | 10,715 | 34.8% | 21.1% | 2.14 |
| 3x and up | 7,652 | 38.3% | 24.1% | 2.40 |

**Sector strength**, measured here for the first time, is real but small, and
it mostly disappears once RS is applied, which is expected since sector rank is
the median RS of its members.

| | n | PF |
|---|---|---|
| sector in the top third that session | 40,539 | 1.97 |
| the rest | 56,055 | 1.80 |
| inside RS 89+: sector top third | 10,856 | 2.31 |
| inside RS 89+: sector bottom third | 4,525 | 2.25 |

A 0.06 spread inside the leaders is not a gate. Sector stays a label.

Sector labels are current memberships applied backwards, so the sector cuts
exclude names that have since delisted and lean toward survivors. The RS,
confidence and volume cuts carry no such bias.

## The change

`confidence >= 0.80` leaves the gate. A 1.5x volume floor on the bar that
cleared the level takes its place, and RS 89 stays.

| Gate | n | share | positive | fail touch | reach | PF |
|---|---|---|---|---|---|---|
| every graded breakout | 97,563 | 100% | 54.9% | 30.7% | 16.0% | 1.87 |
| old: Type1 shape and RS 89+ | 6,337 | 6.5% | 53.1% | 47.9% | 31.3% | 2.30 |
| **new: RS 89+ and 1.5x volume** | **11,199** | **11.5%** | **53.3%** | **47.8%** | **31.8%** | **2.43** |

More breakouts and a better profit factor, and it wins in every decade:

| | new | old |
|---|---|---|
| 1990s | 2.83 | 2.72 |
| 2000s | 2.36 | 2.20 |
| 2010s | 2.26 | 2.25 |
| 2020s | 2.46 | 2.24 |

Two dials exist if the volume of email is ever the problem. RS 93 with the same
volume floor runs 2.52 on 6.9% of the pool, and adding the sector top third to
RS 89 runs 2.59 on 4.8%. Neither is needed today.

The dashboard's default sort changed with it. Within a grade the list ranked by
confidence, which put the 1.76 bucket on top. It now ranks by RS.

## Does it carry anything at all?

Two more cuts, to decide whether it earns a place on the screen.

**Conditioned on the five-bar range it is mostly made of, it adds nothing.**
Inside every range band, a higher score is equal or worse:

| Five-bar range | confidence under 0.92 | 0.92 and over |
|---|---|---|
| 0 to 4% | 1.88 | 1.67 |
| 4 to 6% | 1.91 | 1.68 |
| 6 to 9% | 1.83 | 1.83 |
| 9% and over | 2.44 | 2.33 |

It is a restatement of the range with the sign flipped, not a second opinion.

**Every visual it drove marked the worse half.**

| What the screen painted | n | PF |
|---|---|---|
| elite tint, 0.99 and over | 58,228 | 1.72 |
| strong tint, 0.95 to 0.99 | 9,328 | 2.06 |
| green, 0.95 and over | 67,556 | 1.77 |
| yellow, 0.85 to 0.95 | 14,523 | 2.14 |
| orange, 0.75 to 0.85 | 15,484 | 2.03 |
| ★ High, 0.90 and over | 74,618 | 1.81 |
| no star | 22,945 | 2.09 |

The green rows and the starred rows were the weaker cohort. The orange,
unstarred rows were the stronger one.

And the minimum-confidence slider defaulted to 85, which hides every row
scoring 0.10: the 78% of graded breakouts that are not Type1, and the
better-performing majority.

## What was removed

There is no use case left, so confidence no longer appears on the dashboard.
Gone: the column, the ★ High badge, the green/yellow/orange ramp, the elite and
strong row tints, the minimum-confidence slider, the sort key, the palette
entry, the card tile, and `getSignalColor`, which was built entirely on it and
had no live caller.

RS took the slider, now starting at 0 rather than hiding three quarters of the
board, and took the default secondary sort.

The field is still computed and still returned by the API, because stored rows
carry it and removing it is a migration. Nothing reads it to make a decision or
to tell the reader anything.

Scripts: `scripts/confidence-study.mjs`, `scripts/sector-strength-study.mjs`.

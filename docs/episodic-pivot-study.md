# A base built on a repricing day

September 2026.

The claim, from reading TWLO's own chart: when a base forms right after a
sudden repricing — an earnings gap, a guidance change, a catalyst — the
breakout from that base deserves more weight than one from a base that drifted
into place.

TWLO is the case. On 7 August it closed 24.9% up on 4.22 times its average
volume, built a five-week base on top of that bar, and cleared it on 21
September.

## What counts as one

One session where the market changed its mind about the company. Size on the
close, confirmation from volume, and the base built on top of it rather than
somewhere else:

- the close is 8% or more above the previous close
- volume is 3 times the bar's own 20-day average or more
- it happened within 15 bars of the base high

Both thresholds sit at the edge of the measured effect rather than on round
numbers. Below 8% the bar is an ordinary up day; below 3x the volume does not
confirm that anything was repriced.

## Method

Every base the detector resolves, 1985 to date, that the screen would act on:
the graded shape (blue-sky pivot, depth at or under 25%, close above a rising
200-day) or the deep band (25 to 35% deep, 40 bars or more). 105,840
breakouts across 4,844 symbols, 100k average volume.

Entry is the breakout close. A win is a positive 20-bar return, a fail is a 7%
touch inside 20 bars, profit factor floors each loss at −7%, and reach is a
close 20% above entry inside 60 bars. Baseline for the pool: 54.8% positive,
31.3% fail touches, 16.5% reach, profit factor 1.88.

## It holds

| | n | positive | fail touch | reached +20% | PF |
|---|---|---|---|---|---|
| base built on a repricing day | 8,459 | 51.4% | 49.9% | 31.7% | **2.25** |
| no repricing day | 97,381 | 55.1% | 29.7% | 15.2% | 1.84 |

The same trade as everything else that pays here: it holds less often and runs
much further. The +20% reach doubles.

It survives both bands, so it is not a depth effect in disguise:

| | n | PF |
|---|---|---|
| graded band, with | 7,384 | 2.25 |
| graded band, without | 90,179 | 1.83 |
| deep band, with | 1,075 | 2.29 |
| deep band, without | 7,202 | 1.94 |

And it holds in every decade, which almost nothing does:

| | with | without |
|---|---|---|
| 1990s | 3.48 | 2.09 |
| 2000s | 2.45 | 1.75 |
| 2010s | 1.89 | 1.76 |
| 2020s | 2.11 | 1.81 |

## Bigger is better, and louder is better

| Size of the repricing day | n | reached +20% | PF |
|---|---|---|---|
| 8 to 12% | 3,959 | 27.6% | 2.10 |
| 12 to 18% | 2,721 | 32.8% | 2.26 |
| 18 to 25% | 1,046 | 37.7% | 2.28 |
| 25% and up | 732 | 41.3% | 2.78 |

| Volume on it | n | PF |
|---|---|---|
| 3 to 5x | 4,038 | 2.16 |
| 5 to 8x | 2,557 | 2.18 |
| 8x and up | 1,862 | 2.54 |

## With a real breakout bar behind it

The strongest simple pairing in the study:

| | n | positive | fail touch | reached +20% | PF |
|---|---|---|---|---|---|
| repricing base, breakout on 1.5x+ | 3,984 | 50.9% | 53.8% | 36.1% | **2.56** |
| no repricing base, breakout on 1.5x+ | 32,459 | 54.9% | 33.7% | 19.5% | 2.05 |

More than a third reach +20%, against a fifth.

## What was shipped

A label, not a gate. The detector records the repricing bar on the base, the
base card names it with its size and volume, and the reasoning line carries it
into the alert email.

It is not in the email gate. That gate is RS 89 and 1.5x volume, and a
repricing base with no relative strength is still a name nobody wants. What
this changes is what the screen tells you about a base it already shows.

## The cost, stated plainly

Half of these touch the fail level, against three in ten for the pool. The
edge is entirely in the tail.

Script: `scripts/episodic-pivot-study.mjs`.

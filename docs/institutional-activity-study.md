# Institutional activity study (Sep 2026)

Can the footprint of big buyers in price and volume, measured before a graded
breakout, tell how the breakout goes? Tested on every A+/A breakout in the
full-history cache. Companion to the exit-rules and Minervini studies.

## Method

`apps/breakout-agent/scripts/accumulation-study.mjs` over the local study cache
(5,486 symbols, daily bars, 1985–2026). It replays `base-detect.js`, keeps every
breakout that is graded A+ or A (blue-sky pivot, 25+ bars, 25% deep or less,
close above the 200-day, 100k+ average volume), and measures in the 50
sessions before the breakout:

- **acc / dist** — accumulation and distribution days: close up (down) 1% or
  more on volume 1.5x the trailing 50-day average.
- **bigUp** — up days of 2% or more on 2x volume closing within 5% of the
  52-week high (the institutional print).
- **udv / dry** — the base's up/down volume ratio and volume dry-up.
- **obv** — on-balance-volume drift across the base, as a share of base volume.
- **score 0–10** — points for acc−dist, bigUp, udv and obv (see
  `accumulation-agg.mjs`).

Entry is the breakout close. Win is a positive 20-bar return, stop is a low
7% under entry within 20 bars, PF is gross gains over gross losses with each
trade floored at −7%, "reach +20%" is the best close within 60 bars.
`scripts/accumulation-agg.mjs` prints the tables.

Pool: 44,142 graded breakouts. Baseline 55.8% win, 27.8% stop, PF 1.83,
13.8% reach +20%.

## Findings

**Institutional activity is a size-of-winner lever, not a win-rate lever.**
Every footprint reads the same way RS did: the win rate stays flat or dips,
the stop rate rises, and the winners get much bigger.

| Score | n | win | stop | mean 60-bar | reach +20% | PF |
|---|---|---|---|---|---|---|
| 0 | 13,784 | 56.7% | 24.6% | 2.24% | 10.6% | 1.77 |
| 1–2 | 20,496 | 55.6% | 26.9% | 2.25% | 12.6% | 1.75 |
| 3–4 | 6,884 | 55.6% | 32.7% | 2.71% | 18.7% | 1.98 |
| 5–6 | 2,290 | 53.9% | 35.5% | 2.94% | 23.8% | 2.10 |
| 7–10 | 688 | 53.9% | 42.2% | 5.26% | 31.8% | 2.41 |

**It adds to RS rather than repeating it.** Inside each RS band the top score
bucket has the higher PF and reach.

| RS band | score 0–2 | score 5+ |
|---|---|---|
| 1–69 | PF 1.65, 6.2% reach +20% | PF 1.82, 14.5% |
| 70–88 | PF 1.71, 13.5% | PF 1.96, 20.2% |
| 89–99 | PF 2.18, 27.7% | PF 2.52, 36.7% |

**Activity matters more than direction.** Accumulation days alone are the
strongest single footprint (8+ days: PF 2.35, 32% reach +20%), but
distribution days do not hurt — 5+ heavy down days before the breakout ran PF
2.22 versus 1.74 for none. Heavy volume in both directions means big money
is in the name; net accumulation (acc − dist) is a weaker measure than the
count of heavy days.

**Big prints near the high stack.** 0 prints PF 1.74 and 11% reach; 3–4
prints PF 2.29 and 30%; 5+ prints reach 38% but win only 48% with a 55% stop
rate — the loudest names are also the most volatile.

**Base volume tells confirm the earlier finding.** Up/down volume ratio 1.5x+
runs PF 2.1–2.2; OBV drift above 0.2 of base volume PF 2.09; a deep volume
dry-up (under 0.7x) PF 2.05 — all modest next to the activity count.

**With power volume on the breakout bar** (2x+), score 5+ runs PF 2.79, mean
20-bar +2.4%, 35% reach +20%, and a 43% stop rate. The quiet, score 0–2
corner is the safe small-move bucket: PF 1.66, 9% reach.

**Robust by decade on PF and reach, not on win rate.** Score 5+ beat 0–2 on
PF in every decade (1980s 2.66 vs 2.54, 1990s 2.48 vs 2.12, 2000s 2.31 vs
1.68, 2010s 1.75 vs 1.72, 2020s 1.94 vs 1.66) and on reach +20% in every
decade; it lost on win rate in every decade and stopped out more.

## What this means for the product

- Ship the score as a **label and a ranking**, "institutional activity 0–10",
  on the screener row, in the drawer with the four footprints in words, and
  as a chat tool so "where is the big money going" ranks the pool by it.
- Do **not** gate emails on it. The floor is RS 89+ and confidence 80%+; this
  score raises the payoff, not the hit rate, and the user reads it as such.
- A high score is a bigger-winner, bigger-stop profile. Pair it with the
  20% trail from the exit study, not a tight stop.

Not tested here: 13F ownership deltas, insider buys, FINRA weekly ATS share
(the free dark pool source) — each needs data the cache does not hold.

## Rerun

```
cd apps/breakout-agent
node --max-old-space-size=12000 scripts/accumulation-study.mjs   # ~8 min, writes study-cache/accumulation-rows.json
node scripts/accumulation-agg.mjs
```

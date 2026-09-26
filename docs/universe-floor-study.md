# The two floors that decide what gets scanned

September 2026.

The scan universe is every US stock above **$300M market cap** on NASDAQ, NYSE
and AMEX, then filtered locally to those whose stored **20-day average volume
is at least 100,000 shares**. That takes roughly 3,700 names down to 2,460.

Neither floor had ever been tested, for the obvious reason: every study behind
the grades applied them before counting anything, so each floor's own
population was excluded by definition. This removes them and looks.

Method is the graded shape as always — blue-sky pivot, depth at or under 25%,
close above a rising 200-day — entry at the breakout close, a win is a positive
20-bar return, a fail is a 7% touch inside 20 bars, profit factor floors each
loss at −7%, reach is a close 20% above entry inside 60 bars.

## The market-cap floor earns its place

6,397 breakouts from 2025 onward with a known current market cap.

| | n | positive | fail touch | PF |
|---|---|---|---|---|
| below $300M | 597 | 43.7% | 46.9% | **1.27** |
| at or above $300M | 5,800 | 53.2% | 38.9% | **2.04** |

By band:

| Market cap | n | positive | PF |
|---|---|---|---|
| under $150M | 271 | 48.0% | 1.59 |
| $150M to $300M | 326 | 40.2% | **1.01** |
| $300M to $1B | 913 | 53.3% | 1.90 |
| $1B to $10B | 2,599 | 51.8% | 2.01 |
| $10B to $100B | 1,766 | 53.3% | 1.96 |
| above $100B | 522 | 59.6% | 2.89 |

The band immediately under the floor is the worst thing in the study: a profit
factor of 1.01 means the winners and losers cancel exactly.

And the names the cap floor *uniquely* removes — under $300M but clearing the
share floor — run 36.7% positive, 61.7% fail touches, profit factor 1.16.

One caveat that runs in our favour: 994 of 7,391 recent breakouts carry no
current market cap because the company has since delisted, and delistings skew
small. Their absence makes small caps look **better** than they were, and they
still look bad. Keep the floor.

## The liquidity floor is a harder question

Removing it adds 31,245 breakouts to a pool of 128,153.

| | n | positive | fail touch | reached +20% | PF |
|---|---|---|---|---|---|
| below 100k average shares | 31,245 | 52.4% | 29.8% | 18.9% | **2.16** |
| at or above | 96,908 | 54.9% | 30.6% | 15.9% | **1.85** |

The excluded names score better. Not marginally, and not by accident — it is
monotone, and it holds in all four decades.

| Average share volume | n | PF |
|---|---|---|
| under 25k | 14,362 | 2.28 |
| 25k to 50k | 6,995 | 2.05 |
| 50k to 100k | 9,888 | 2.07 |
| 100k to 250k | 18,094 | 1.94 |
| 250k to 1M | 34,529 | 1.83 |
| above 1M | 44,285 | 1.84 |

### Why that is not an argument for removing it

Look at where the edge concentrates.

| Average dollar volume | n | PF |
|---|---|---|
| under $500k/day | 24,219 | **2.51** |
| $500k to $2M | 19,133 | 1.98 |
| $2M to $10M | 26,843 | 1.87 |
| $10M to $50M | 28,450 | 1.73 |
| above $50M | 29,508 | 1.73 |

And by price, among the names below the share floor: under $5 runs 2.90, $5 to
$15 runs 2.18, $15 to $50 runs 1.64.

Profit factor rises exactly as tradability falls. Split the pool on whether a
$25,000 position could be filled at 1% of a day's turnover:

| | n | PF |
|---|---|---|
| tradable at 1% participation | 81,385 | 1.76 |
| not tradable | 46,768 | **2.25** |

Every entry and exit in this study is a closing price. In a name that turns
over $300,000 a day, the close is not a price anyone gets. The premium in the
thin buckets is mostly the spread we are not paying and the impact we are not
causing. It is a measurement artifact, not an edge being left on the table.

### The unit is wrong, though

100,000 shares is not a measure of liquidity. It admits a $2 stock trading
150,000 shares — $300,000 a day, untradable — and rejects a $300 stock trading
80,000 shares, which is $24M a day.

A dollar floor of about $750k a day keeps almost exactly the same share of the
pool as today's rule:

| Floor | kept | share of pool | PF of what is kept |
|---|---|---|---|
| 100k shares (today) | 96,908 | 76% | 1.85 |
| $500k/day | 103,934 | 81% | 1.81 |
| **$750k/day** | **98,854** | **77%** | **1.80** |
| $1M/day | 95,032 | 74% | 1.80 |
| $2M/day | 84,801 | 66% | 1.77 |

The swap at $750k a day:

- **adds** 8,820 breakouts that are thin in shares but real in dollars, profit factor 1.71
- **cuts** 6,874 that clear 100k shares on no money at all, profit factor 2.57, and **95% of them trade under $5**

That second line is the whole argument in one number. The names a dollar floor
would remove score better on paper than anything else in the study, and they
are almost entirely sub-$5 stocks turning over a few hundred thousand dollars.
Switching units would *lower* measured profit factor while making the screen
honest about what can actually be bought.

## What this says to do

Keep the market-cap floor. It is measured, it is large, and the bias runs
against the conclusion rather than for it.

Keep a liquidity floor. The apparent reward for removing it is concentrated in
names whose measured returns depend on fills nobody would get.

Consider changing its unit from shares to dollars, at roughly $750k a day,
which holds the universe the same size while admitting genuinely liquid
high-priced names and rejecting cheap ones that clear a share count on no
turnover. Expect measured profit factor to fall slightly when you do; that is
the artifact leaving, not the edge.

Whatever number is chosen, it should be set by what can be filled, not by
profit factor. This study cannot price slippage, and in exactly the region
where the floor matters, slippage is the whole question.

Scripts: `scripts/liquidity-floor-study.mjs`, `scripts/marketcap-floor-study.mjs`.

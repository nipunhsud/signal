# Exit-rule study for graded breakouts (Sep 2026)

Report version: https://claude.ai/code/artifact/2ff75333-b21d-459b-b0b5-6ecde6edede6

**Provenance.** Raw full-history replay of the production base detector, not
the live `BreakoutSignal` table (graded alerts only exist since Sep 2026 — far
too few to rank exit rules). Live signals get measured against these numbers
during the paper run.

**Question.** The trader needs a sell rule. The user's habit is "take some
off at +20%"; O'Neil's rules are a 7–8% stop, sell into +20–25% unless the
stock got there in under 3 weeks (then hold 8 weeks), and sell on a close
below the 50-day MA. Which of these, or a fixed horizon, or a trailing stop,
is the best use of a position slot?

**Data.** Same path as the base-grade study: Yahoo max-range daily bars for
5,484 NASDAQ/NYSE symbols (warrants/units dropped), `base-detect.js` replayed
over full history, entries at the close that resolved a blue-sky pivot, above
the 200MA, ≥100k avg volume, graded S/A+/A by the production cut. **97,789
breakouts, 1970s–2026.** Every strategy runs a 7% hard stop on the low
(gap-through fills at the open); close-based signals fill at the next open;
open-ended rules are capped at 250 bars. No slippage or commissions.

Rerun: `pnpm -F breakout-agent build && cd apps/breakout-agent && node dist/scripts/backtest-exits.js`
(bars cache in `apps/breakout-agent/study-cache/`, ~1 GB, gitignored).

Columns: win = share of trades with ret > 0 · PF = gross wins / gross losses ·
bars = mean holding period · %/mo = mean return ÷ bars × 21 (capital
efficiency, the number that matters with a 5-slot book) · stop = share ending
at the 7% hard stop · exits = how trades ended.

## Findings

1. **Selling into +20% does not help.** "Half at +20%, rest MA50" earns
   0.99% mean vs 1.10% for the plain MA50 rule; "all out at +20%" earns
   0.88%. Only ~15% of trades ever reach +20% under MA50 management, and
   the partial caps exactly the trades that carry the average. Cost is small
   (~0.1% per trade), so keeping it as a habit is affordable, but it is not
   a source of edge.
2. **Close below the 50MA is the best single sell rule.** Same mean as a
   42-bar fixed hold (1.10% vs 1.04%) with the hard-stop rate cut from 45%
   to 25%: it exits losers at -2 to -3% before they reach -7%. Holds 34 bars
   on average. On S-grade breakouts it is 1.77% mean, PF 1.91, 8% stops.
3. **Trailing stops make the most per trade but tie up the slot.** A 20%
   trail from the peak earns 3.73% mean (PF 1.80, the best) but holds 95
   bars and two-thirds of trades still end at the hard stop because the
   trail only rises above entry after a +25% move. Per month it is 0.83%
   vs 0.68% for MA50 — a real but modest gain for 3× the holding time.
   Combining a 15% trail with MA50 is worse than MA50 alone (0.89%).
4. **The 20MA is too tight.** Highest turnover, lowest PF (1.16); it sells
   normal pullbacks.
5. **O'Neil's composite adds nothing over its MA50 component** (0.99% vs
   1.10%). The 8-week hold rarely triggers (12% reach the target inside 15
   bars) and when it does the MA50 exit was already doing the work.
6. **Grade dominates the exit.** S beats A on every rule by 2–4× in PF
   terms; the exit rule moves results by tenths of a percent, the grade by
   whole percents.
7. **2010–2026 is weaker across the board** (mean returns roughly half of
   pre-2010) but the ordering of rules is unchanged.

## Recommendation for the trader

- Keep the 7% hard stop (already a GTC stop leg at the broker).
- Add **exit on close below the 50-day MA, filled next open** as the
  primary sell rule. Needs daily bars from Alpaca's data API; one call per
  open position per evening.
- Set `TRADE_HOLD_DAYS` to a backstop rather than the exit: 90 calendar
  days (~63 bars) catches the rare position that hugs the 50MA forever.
- Do **not** implement a +20% partial in v1. If wanted later as a
  preference, "half at +20%, rest MA50" costs ~0.1% per trade.
- Consider the 20% trail only for S-grade names, where it earns 7.4% mean
  (PF 2.94) vs 1.8% for MA50, at the price of 145-bar holds.

## Peter Brandt's 3-day trailing stop

Stop under the lowest low of the prior three sessions, ratcheted daily, never
lowered. Measured from entry, armed after a +10% or +20% move (Brandt uses it
to protect parabolic runs), close-based, and layered on top of the MA50 rule.

| Rule | Win | Mean | PF | Bars | %/mo | Ends at stop |
| --- | --- | --- | --- | --- | --- | --- |
| Brandt 3-day low, from entry | 38.6% | 0.05% | 1.03 | 6 | 0.16% | 60% |
| Brandt 3-day low, armed after +10% | 48.2% | 1.18% | 1.32 | 40 | 0.62% | 51% |
| Brandt 3-day low, armed after +20% | 36.4% | 2.29% | 1.50 | 66 | 0.73% | 63% |
| Brandt 3-day low, close-based, from entry | 40.6% | 0.18% | 1.09 | 12 | 0.33% | 10% |
| MA50 + Brandt after +20% | 36.7% | 0.83% | 1.27 | 29 | 0.61% | 25% |
| MA50 + Brandt after +10% | 40.9% | 0.59% | 1.21 | 23 | 0.55% | 24% |
| *for reference:* MA50 | 36.0% | 1.10% | 1.35 | 34 | 0.68% | 25% |
| *for reference:* trail 20% | 32.4% | 3.73% | 1.80 | 95 | 0.83% | 67% |

- **From entry it is harmful.** A fresh breakout's 3-day low is the base it just
  left; ordinary post-breakout pullbacks take it out in a week (6 bars, PF 1.03).
- **Armed after +20% it is a middle path**: PF 1.50 between MA50 (1.35) and the
  20% trail (1.80), with shorter holds than the trail. On S grade it does well
  (5.6% mean, PF 2.48), and armed after +10% on S it has the best *median* of
  any rule (+6.9%).
- **Stacked on MA50 it hurts** (0.83% vs 1.10%): it clips winners the MA rule
  would have carried.

## Portfolio simulation: which rule grows the book

Per-trade averages ignore the slot constraint. This replays the signal stream
day by day with a **5-slot book, 1% of equity at risk per trade** (7% stop → a
14.3% position, capped at 20%), no leverage, filling free slots from that
day's breakouts with S > A+ > A priority. Every position is marked to market
daily from its own price path. Script: `node dist/scripts/portfolio-sim.js
[--slots 5] [--risk 1] [--from 1990] [--seeds 12] [--nograde]`.

Because slots are full almost every day, *which* of a day's signals get taken
is a tie-break, and a single ordering is noisy (one seed put the adopted
composite at 4.2% and another at 7.2%). The tables average 12 random
within-day orderings and report the min–max spread.

```
# 12 seeds, grade priority, 1990+
=== 12 random within-day orderings (S > A+ > A priority), 1990– ===
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr
fixed21 · 7% stop                      5.4%    3.8%    6.8%       39.1%   45.4%    0.55         67
stop · close<MA50                      5.4%    4.0%    7.5%       38.4%   44.4%    0.52         35
stop · trail 20%                       7.0%    3.6%   12.5%       30.9%   36.0%    0.76         12
half +20% · rest MA50                  5.2%    3.8%    7.0%       33.9%   40.3%    0.58         35
Brandt 3d-low trail after +20%         6.2%    4.2%    9.1%       31.7%   43.0%    0.77         17
ADOPTED: MA50, trail 20% on S          5.4%    3.9%    7.2%       37.4%   41.9%    0.55         23

# 12 seeds, grade priority OFF, 1990+
=== 12 random within-day orderings (grade priority OFF), 1990– ===
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr
fixed21 · 7% stop                      4.0%    2.1%    6.2%       44.6%   54.8%    0.38         71
stop · close<MA50                      5.7%    3.9%    8.3%       47.0%   62.9%    0.47         37
stop · trail 20%                       7.1%    4.1%    9.9%       34.7%   44.3%    0.70         15
half +20% · rest MA50                  5.2%    4.0%    6.8%       38.4%   47.2%    0.51         37
Brandt 3d-low trail after +20%         5.1%    3.2%    6.7%       36.9%   55.3%    0.57         20
ADOPTED: MA50, trail 20% on S          5.6%    3.3%    7.5%       46.3%   66.0%    0.47         33

# 12 seeds, grade priority, 2010+
=== 12 random within-day orderings (S > A+ > A priority), 2010– ===
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr
fixed21 · 7% stop                      4.7%    2.5%    7.1%       33.3%   44.6%    0.48         67
stop · close<MA50                      4.3%    2.6%    7.2%       34.6%   43.8%    0.42         36
stop · trail 20%                       7.0%    2.8%   10.1%       24.4%   32.3%    0.74         12
half +20% · rest MA50                  4.0%    2.1%    6.4%       30.8%   40.3%    0.45         36
Brandt 3d-low trail after +20%         4.8%    2.2%    6.7%       24.9%   37.6%    0.59         17
ADOPTED: MA50, trail 20% on S          4.0%    1.6%    6.3%       34.9%   41.0%    0.44         23

# single ordering (seed 1), 1990+ with decade breakdown
=== 5-slot book, 1% risk/trade (7% stop → 14.3% of equity per position, cap 20%), 1990–2026 ===
rule                                CAGR   maxDD    vol  Sharpe  trades/yr  in mkt  worst yr  best yr  growth of $1
fixed21 · 7% stop                   4.3%   44.6%    10%    0.46         67    100%    -26.7%    46.5%  $4
stop · close<MA50                   7.5%   37.7%    12%    0.67         35    100%    -23.3%    38.8%  $12
stop · trail 20%                    6.3%   33.5%     9%    0.71         12    100%    -21.8%    36.8%  $8
half +20% · rest MA50               7.0%   34.0%    10%    0.75         35    100%    -21.2%    34.8%  $10
Brandt 3d-low trail after +20%      9.1%   30.3%     9%    1.05         18    100%    -15.1%    48.9%  $19
ADOPTED: MA50, trail 20% on S       6.3%   41.0%    10%    0.64         23    100%    -33.6%    32.4%  $8

CAGR by decade:
rule                               1990s   2000s   2010s   2020s
fixed21 · 7% stop                  11.0%   -2.0%    7.4%   -2.0%
stop · close<MA50                  12.5%    0.6%    9.2%    4.4%
stop · trail 20%                    5.4%    3.3%    9.4%    5.7%
half +20% · rest MA50              11.5%    1.1%    8.4%    3.6%
Brandt 3d-low trail after +20%     12.3%    5.6%    9.7%    4.8%
ADOPTED: MA50, trail 20% on S      12.1%    1.2%    6.3%    2.5%
```

- **The 20% trail is the best rule for the book**, not just the best per
  trade: highest CAGR (7.0% vs 5.4% for MA50), lowest drawdown (31% vs 38%),
  best Sharpe (0.76 vs 0.52), with a third of the trades. It holds in 2010+
  and with grade priority off.
- **MA50's advantage was slot turnover, and turnover buys nothing here**: the
  refilled slot gets an average signal, and average signals barely beat zero
  after the first month. Fixed-21 and MA50 land in the same place.
- **Brandt after +20% is second** (6.2% CAGR, Sharpe 0.77) with priority on,
  but slips to 5.1% with it off — it leans on catching S-grade runners.
- **The +20% partial is last or near last** in every configuration.
- **The adopted composite (MA50 for A+/A, trail for S) tracks MA50** because
  S is 4% of the stream. Trailing every grade is the setting the evidence
  supports: `TRADE_TRAIL_GRADES=S,A+,A`.
- Absolute CAGRs (4–7% on a 71%-invested, unlevered book) should be read
  as relative, not as forecasts: the universe is today's listings
  (survivorship bias flatters it), fills are frictionless, and the raw
  signal stream is broader than what the scanner emails.

## Sizing grid: slots × risk × cap × trail width

`portfolio-sim.js --slots N --risk R --cap C --only "trail"`, 12 orderings,
1990–2026, unlevered (a position is `min(risk/7%, cap, cash)`). Selected rows;
the full grid is in the log below.

| Slots | Risk/trade | Position | Invested | CAGR | min–max | Max DD | Sharpe | Trades/yr |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | 1% | 14% | ≤43% | 4.6% | 2.5–7.4% | 20% | 0.67 | 7 |
| 5 | 1% | 14% | ≤71% | 7.0% | 3.6–12.5% | 31% | 0.76 | 12 |
| 5 | 1.5% | 21% | 100% | 9.0% | 4.4–16.2% | 38% | 0.76 | 12 |
| 5 | 2% | 29% | 100% | 9.3% | 6.2–15.7% | 38% | 0.74 | 12 |
| 5 | 3% | 40% cap | 100% | 9.6% | 5.5–16.4% | 38% | 0.70 | 10 |
| 8 | 1% | 14% | 100% | 8.6% | 4.8–13.6% | 38% | 0.83 | 20 |
| 10 | 1% | 14% | 100% | 9.0% | 5.6–13.6% | 39% | 0.87 | 24 |
| 3 | 3% | 40% cap | 100% | 9.7% | 5.0–16.3% | 39% | 0.68 | 7 |

Trail width at 5 slots / 1% risk: 15% → 7.1% CAGR, Sharpe 0.81 (1990+) but
6.4% / 0.71 in 2010+; 20% → 7.0% / 0.76 and the best 2010+ line (7.0%, 24%
DD); 25% → 6.7% / 0.67; 30% → 7.4% / 0.74 but the worst drawdowns. 20% is
the robust pick.

- **The book caps out near 9–9.5% a year once it is fully invested.** Five
  slots at 1.5% risk already demand 107% of equity, so raising risk beyond
  that changes nothing but the drawdown. The "2% risk doubles the return"
  intuition is wrong without margin: 5 slots / 2% gives 9.3%, not 14%.
- **Diversification is the free lever.** 10 slots at 1% risk earns the same
  9.0% as 5 slots at 2%, with the best Sharpe in the grid (0.87), the best
  worst-case ordering (5.6%), and half the concentration.
- **The drawdown is set by exposure, not by risk per trade.** Every
  fully-invested row sits at 37–39% max DD; the only way under 31% is to
  hold cash (5 slots / 1% = 71% invested → 31%; 3 slots → 20%).
- **Two sensible operating points:** *conservative* 5 slots / 1% / trail 20%
  (7% a year, 31% DD, 71% invested) or *fully invested* 8–10 slots / 1% /
  trail 20% (9% a year, 38% DD, Sharpe 0.85). Nothing in the grid beats the
  second on return without giving up Sharpe.

```
### slots=3 risk=1 cap=20
stop · close<MA50                      3.9%    2.4%    5.4%       29.8%   37.0%    0.48         21
stop · trail 20%                       4.6%    2.5%    7.4%       20.2%   29.7%    0.67          7
ADOPTED: MA50, trail 20% on S          3.6%    1.6%    5.3%       30.4%   39.8%    0.48         14
### slots=3 risk=1 cap=30
stop · close<MA50                      3.9%    2.4%    5.4%       29.8%   37.0%    0.48         21
stop · trail 20%                       4.6%    2.5%    7.4%       20.2%   29.7%    0.67          7
ADOPTED: MA50, trail 20% on S          3.6%    1.6%    5.3%       30.4%   39.8%    0.48         14
### slots=3 risk=1 cap=40
stop · close<MA50                      3.9%    2.4%    5.4%       29.8%   37.0%    0.48         21
stop · trail 20%                       4.6%    2.5%    7.4%       20.2%   29.7%    0.67          7
ADOPTED: MA50, trail 20% on S          3.6%    1.6%    5.3%       30.4%   39.8%    0.48         14
### slots=3 risk=1.5 cap=20
stop · close<MA50                      5.2%    3.2%    7.3%       38.2%   47.5%    0.49         21
stop · trail 20%                       6.2%    3.3%   10.2%       27.1%   38.9%    0.67          7
ADOPTED: MA50, trail 20% on S          4.9%    2.1%    7.1%       39.1%   51.1%    0.49         14
### slots=3 risk=1.5 cap=30
stop · close<MA50                      5.6%    3.4%    7.8%       40.1%   49.8%    0.49         21
stop · trail 20%                       6.6%    3.5%   10.8%       28.7%   41.1%    0.67          7
ADOPTED: MA50, trail 20% on S          5.2%    2.2%    7.5%       41.2%   53.6%    0.49         14
### slots=3 risk=1.5 cap=40
stop · close<MA50                      5.6%    3.4%    7.8%       40.1%   49.8%    0.49         21
stop · trail 20%                       6.6%    3.5%   10.8%       28.7%   41.1%    0.67          7
ADOPTED: MA50, trail 20% on S          5.2%    2.2%    7.5%       41.2%   53.6%    0.49         14
### slots=3 risk=2 cap=20
stop · close<MA50                      5.2%    3.2%    7.3%       38.2%   47.5%    0.49         21
stop · trail 20%                       6.2%    3.3%   10.2%       27.1%   38.9%    0.67          7
ADOPTED: MA50, trail 20% on S          4.9%    2.1%    7.1%       39.1%   51.1%    0.49         14
### slots=3 risk=2 cap=30
stop · close<MA50                      7.1%    4.2%   10.2%       48.2%   60.0%    0.50         21
stop · trail 20%                       8.5%    4.5%   14.1%       36.2%   50.5%    0.67          7
ADOPTED: MA50, trail 20% on S          6.6%    2.7%    9.6%       50.2%   64.2%    0.49         14
### slots=3 risk=2 cap=40
stop · close<MA50                      7.1%    4.2%   10.2%       48.2%   60.0%    0.50         21
stop · trail 20%                       8.5%    4.5%   14.1%       36.2%   50.5%    0.67          7
ADOPTED: MA50, trail 20% on S          6.6%    2.7%    9.6%       50.2%   64.2%    0.49         14
### slots=3 risk=3 cap=20
stop · close<MA50                      5.2%    3.2%    7.3%       38.2%   47.5%    0.49         21
stop · trail 20%                       6.2%    3.3%   10.2%       27.1%   38.9%    0.67          7
ADOPTED: MA50, trail 20% on S          4.9%    2.1%    7.1%       39.1%   51.1%    0.49         14
### slots=3 risk=3 cap=30
stop · close<MA50                      7.3%    4.4%   10.6%       49.6%   61.8%    0.50         21
stop · trail 20%                       8.9%    4.7%   14.6%       37.4%   51.6%    0.67          7
ADOPTED: MA50, trail 20% on S          6.8%    2.8%   10.0%       51.8%   66.0%    0.50         14
### slots=3 risk=3 cap=40
stop · close<MA50                      8.0%    5.0%   11.9%       53.3%   63.8%    0.50         21
stop · trail 20%                       9.7%    5.0%   16.3%       38.5%   48.9%    0.68          7
ADOPTED: MA50, trail 20% on S          7.4%    3.6%   10.8%       53.9%   65.8%    0.50         14
### slots=5 risk=1 cap=20
stop · close<MA50                      5.4%    4.0%    7.5%       38.4%   44.4%    0.52         35
stop · trail 20%                       7.0%    3.6%   12.5%       30.9%   36.0%    0.76         12
ADOPTED: MA50, trail 20% on S          5.4%    3.9%    7.2%       37.4%   41.9%    0.55         23
### slots=5 risk=1 cap=30
stop · close<MA50                      5.4%    4.0%    7.5%       38.4%   44.4%    0.52         35
stop · trail 20%                       7.0%    3.6%   12.5%       30.9%   36.0%    0.76         12
ADOPTED: MA50, trail 20% on S          5.4%    3.9%    7.2%       37.4%   41.9%    0.55         23
### slots=5 risk=1 cap=40
stop · close<MA50                      5.4%    4.0%    7.5%       38.4%   44.4%    0.52         35
stop · trail 20%                       7.0%    3.6%   12.5%       30.9%   36.0%    0.76         12
ADOPTED: MA50, trail 20% on S          5.4%    3.9%    7.2%       37.4%   41.9%    0.55         23
### slots=5 risk=1.5 cap=20
stop · close<MA50                      7.2%    5.1%   10.6%       47.4%   55.4%    0.53         35
stop · trail 20%                       9.0%    4.4%   16.2%       37.9%   45.2%    0.76         12
ADOPTED: MA50, trail 20% on S          7.0%    5.0%    9.2%       46.0%   51.1%    0.56         23
### slots=5 risk=1.5 cap=30
stop · close<MA50                      7.3%    5.0%   10.9%       47.2%   54.2%    0.54         35
stop · trail 20%                       9.1%    4.6%   16.6%       37.5%   46.6%    0.76         12
ADOPTED: MA50, trail 20% on S          6.9%    5.3%    9.2%       46.7%   51.6%    0.55         23
### slots=5 risk=1.5 cap=40
stop · close<MA50                      7.3%    5.0%   10.9%       47.2%   54.2%    0.54         35
stop · trail 20%                       9.1%    4.6%   16.6%       37.5%   46.6%    0.76         12
ADOPTED: MA50, trail 20% on S          6.9%    5.3%    9.2%       46.7%   51.6%    0.55         23
### slots=5 risk=2 cap=20
stop · close<MA50                      7.2%    5.1%   10.6%       47.4%   55.4%    0.53         35
stop · trail 20%                       9.0%    4.4%   16.2%       37.9%   45.2%    0.76         12
ADOPTED: MA50, trail 20% on S          7.0%    5.0%    9.2%       46.0%   51.1%    0.56         23
### slots=5 risk=2 cap=30
stop · close<MA50                      7.6%    5.3%   10.3%       50.7%   58.2%    0.53         34
stop · trail 20%                       9.3%    6.2%   15.7%       38.2%   48.0%    0.74         12
ADOPTED: MA50, trail 20% on S          7.5%    5.0%   10.7%       47.3%   52.3%    0.56         22
### slots=5 risk=2 cap=40
stop · close<MA50                      7.6%    5.3%   10.3%       50.7%   58.2%    0.53         34
stop · trail 20%                       9.3%    6.2%   15.7%       38.2%   48.0%    0.74         12
ADOPTED: MA50, trail 20% on S          7.5%    5.0%   10.7%       47.3%   52.3%    0.56         22
### slots=5 risk=3 cap=20
stop · close<MA50                      7.2%    5.1%   10.6%       47.4%   55.4%    0.53         35
stop · trail 20%                       9.0%    4.4%   16.2%       37.9%   45.2%    0.76         12
ADOPTED: MA50, trail 20% on S          7.0%    5.0%    9.2%       46.0%   51.1%    0.56         23
### slots=5 risk=3 cap=30
stop · close<MA50                      7.5%    5.3%   10.5%       51.1%   59.0%    0.51         34
stop · trail 20%                       9.3%    6.4%   15.2%       38.9%   47.8%    0.73         12
ADOPTED: MA50, trail 20% on S          7.5%    4.8%    9.4%       49.0%   55.3%    0.55         22
### slots=5 risk=3 cap=40
stop · close<MA50                      8.1%    6.3%   11.6%       52.5%   64.5%    0.51         29
stop · trail 20%                       9.6%    5.5%   16.4%       37.8%   46.6%    0.70         10
ADOPTED: MA50, trail 20% on S          7.6%    5.7%   10.4%       51.0%   57.9%    0.52         20
### slots=8 risk=1 cap=20
stop · close<MA50                      7.2%    5.0%    9.8%       44.9%   52.5%    0.59         56
stop · trail 20%                       8.6%    4.8%   13.6%       38.4%   44.2%    0.83         20
ADOPTED: MA50, trail 20% on S          7.6%    5.1%    9.7%       44.0%   52.1%    0.66         37
### slots=8 risk=1 cap=30
stop · close<MA50                      7.2%    5.0%    9.8%       44.9%   52.5%    0.59         56
stop · trail 20%                       8.6%    4.8%   13.6%       38.4%   44.2%    0.83         20
ADOPTED: MA50, trail 20% on S          7.6%    5.1%    9.7%       44.0%   52.1%    0.66         37
### slots=8 risk=1 cap=40
stop · close<MA50                      7.2%    5.0%    9.8%       44.9%   52.5%    0.59         56
stop · trail 20%                       8.6%    4.8%   13.6%       38.4%   44.2%    0.83         20
ADOPTED: MA50, trail 20% on S          7.6%    5.1%    9.7%       44.0%   52.1%    0.66         37
### slots=8 risk=1.5 cap=20
stop · close<MA50                      7.4%    4.8%   10.3%       46.3%   57.4%    0.56         48
stop · trail 20%                       9.0%    4.6%   15.3%       38.3%   46.1%    0.80         18
ADOPTED: MA50, trail 20% on S          7.7%    5.1%    9.4%       44.9%   50.1%    0.63         34
### slots=8 risk=1.5 cap=30
stop · close<MA50                      7.5%    5.3%   10.5%       47.0%   56.8%    0.55         46
stop · trail 20%                       9.3%    5.8%   15.9%       38.4%   45.2%    0.81         18
ADOPTED: MA50, trail 20% on S          7.7%    4.9%    9.4%       45.1%   50.4%    0.61         32
### slots=8 risk=1.5 cap=40
stop · close<MA50                      7.5%    5.3%   10.5%       47.0%   56.8%    0.55         46
stop · trail 20%                       9.3%    5.8%   15.9%       38.4%   45.2%    0.81         18
ADOPTED: MA50, trail 20% on S          7.7%    4.9%    9.4%       45.1%   50.4%    0.61         32
### slots=8 risk=2 cap=20
stop · close<MA50                      7.4%    4.8%   10.3%       46.3%   57.4%    0.56         48
stop · trail 20%                       9.0%    4.6%   15.3%       38.3%   46.1%    0.80         18
ADOPTED: MA50, trail 20% on S          7.7%    5.1%    9.4%       44.9%   50.1%    0.63         34
### slots=8 risk=2 cap=30
stop · close<MA50                      7.5%    5.7%   10.6%       50.4%   58.6%    0.52         40
stop · trail 20%                       9.2%    5.2%   16.4%       39.4%   51.2%    0.75         15
ADOPTED: MA50, trail 20% on S          7.7%    5.3%    9.7%       47.5%   56.5%    0.57         27
### slots=8 risk=2 cap=40
stop · close<MA50                      7.5%    5.7%   10.6%       50.4%   58.6%    0.52         40
stop · trail 20%                       9.2%    5.2%   16.4%       39.4%   51.2%    0.75         15
ADOPTED: MA50, trail 20% on S          7.7%    5.3%    9.7%       47.5%   56.5%    0.57         27
### slots=8 risk=3 cap=20
stop · close<MA50                      7.4%    4.8%   10.3%       46.3%   57.4%    0.56         48
stop · trail 20%                       9.0%    4.6%   15.3%       38.3%   46.1%    0.80         18
ADOPTED: MA50, trail 20% on S          7.7%    5.1%    9.4%       44.9%   50.1%    0.63         34
### slots=8 risk=3 cap=30
stop · close<MA50                      7.6%    5.7%   10.6%       50.7%   58.7%    0.52         39
stop · trail 20%                       9.3%    5.1%   16.3%       38.9%   51.8%    0.74         15
ADOPTED: MA50, trail 20% on S          7.7%    5.0%    9.9%       48.3%   57.8%    0.56         26
### slots=8 risk=3 cap=40
stop · close<MA50                      8.0%    6.2%   11.4%       52.8%   64.4%    0.51         30
stop · trail 20%                       9.5%    6.1%   16.3%       37.6%   46.5%    0.70         12
ADOPTED: MA50, trail 20% on S          7.5%    5.5%    9.9%       50.8%   58.2%    0.52         21
### slots=10 risk=1 cap=20
stop · close<MA50                      7.3%    4.7%   10.2%       45.1%   51.0%    0.59         62
stop · trail 20%                       9.0%    5.6%   13.6%       38.8%   45.9%    0.87         24
ADOPTED: MA50, trail 20% on S          7.9%    5.8%    9.6%       43.4%   49.0%    0.69         44
### slots=10 risk=1 cap=30
stop · close<MA50                      7.3%    4.7%   10.2%       45.1%   51.0%    0.59         62
stop · trail 20%                       9.0%    5.6%   13.6%       38.8%   45.9%    0.87         24
ADOPTED: MA50, trail 20% on S          7.9%    5.8%    9.6%       43.4%   49.0%    0.69         44
### slots=10 risk=1 cap=40
stop · close<MA50                      7.3%    4.7%   10.2%       45.1%   51.0%    0.59         62
stop · trail 20%                       9.0%    5.6%   13.6%       38.8%   45.9%    0.87         24
ADOPTED: MA50, trail 20% on S          7.9%    5.8%    9.6%       43.4%   49.0%    0.69         44
### slots=10 risk=1.5 cap=20
stop · close<MA50                      7.5%    4.9%   10.4%       46.4%   57.3%    0.56         49
stop · trail 20%                       9.3%    5.4%   15.0%       37.4%   44.1%    0.83         20
ADOPTED: MA50, trail 20% on S          7.8%    5.7%    9.2%       45.1%   50.1%    0.63         35
### slots=10 risk=1.5 cap=30
stop · close<MA50                      7.5%    5.3%   10.7%       47.3%   57.4%    0.55         47
stop · trail 20%                       9.2%    5.9%   15.0%       37.9%   43.9%    0.81         19
ADOPTED: MA50, trail 20% on S          7.8%    5.9%    9.4%       45.2%   50.4%    0.62         33
### slots=10 risk=1.5 cap=40
stop · close<MA50                      7.5%    5.3%   10.7%       47.3%   57.4%    0.55         47
stop · trail 20%                       9.2%    5.9%   15.0%       37.9%   43.9%    0.81         19
ADOPTED: MA50, trail 20% on S          7.8%    5.9%    9.4%       45.2%   50.4%    0.62         33
### slots=10 risk=2 cap=20
stop · close<MA50                      7.5%    4.9%   10.4%       46.4%   57.3%    0.56         49
stop · trail 20%                       9.3%    5.4%   15.0%       37.4%   44.1%    0.83         20
ADOPTED: MA50, trail 20% on S          7.8%    5.7%    9.2%       45.1%   50.1%    0.63         35
### slots=10 risk=2 cap=30
stop · close<MA50                      7.5%    5.6%   10.6%       50.3%   58.6%    0.52         40
stop · trail 20%                       9.1%    5.2%   16.0%       38.7%   51.2%    0.74         16
ADOPTED: MA50, trail 20% on S          7.6%    5.3%    9.6%       47.8%   56.5%    0.57         27
### slots=10 risk=2 cap=40
stop · close<MA50                      7.5%    5.6%   10.6%       50.3%   58.6%    0.52         40
stop · trail 20%                       9.1%    5.2%   16.0%       38.7%   51.2%    0.74         16
ADOPTED: MA50, trail 20% on S          7.6%    5.3%    9.6%       47.8%   56.5%    0.57         27
### slots=10 risk=3 cap=20
stop · close<MA50                      7.5%    4.9%   10.4%       46.4%   57.3%    0.56         49
stop · trail 20%                       9.3%    5.4%   15.0%       37.4%   44.1%    0.83         20
ADOPTED: MA50, trail 20% on S          7.8%    5.7%    9.2%       45.1%   50.1%    0.63         35
### slots=10 risk=3 cap=30
stop · close<MA50                      7.6%    5.6%   10.6%       50.7%   58.7%    0.52         39
stop · trail 20%                       9.2%    5.1%   16.1%       38.4%   51.8%    0.74         15
ADOPTED: MA50, trail 20% on S          7.6%    5.0%    9.8%       48.3%   57.8%    0.56         26
### slots=10 risk=3 cap=40
stop · close<MA50                      8.0%    6.2%   11.4%       52.8%   64.4%    0.51         30
stop · trail 20%                       9.5%    6.1%   16.3%       37.6%   46.9%    0.70         12
ADOPTED: MA50, trail 20% on S          7.5%    5.5%    9.9%       50.8%   58.2%    0.52         21
## rebuilding paths with trail 15/25/30
```

## Recommendation, revised after the portfolio simulation

- Keep the 7% hard stop and the 90-day backstop.
- **Trail 20% from the peak high on every grade.** This is now the trader's
  default (`TRADE_TRAIL_GRADES=S,A+,A`).
- **Size for the drawdown you can hold**, via the `TRADE_PROFILE` lever:
  `invested` (default: 10 slots / 1% risk, ~9%/yr, 38% DD) or `conservative`
  (5 slots / 1% risk, 71% invested, ~7%/yr, 31% DD). Raising risk per trade
  past ~1.4% on 5 slots buys nothing unlevered.
- Keep MA50 available as the alternative for a faster-turnover book; do not
  combine it with the trail.
- No +20% partial.

## Base depth: is <10% the real top tier?

Sky bases above the 200MA, depth ≤25%, by depth bucket:

| depth | n (≥25 bars) | 20d win | 20d stop | 63d win | 63d stop | 63d mean | reached +20% in 63d |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0–5% | 2,435 | 58.0% | 10.4% | 63.2% | 27.8% | 1.66% | 4.3% |
| 5–10% | 12,893 | 57.9% | 20.0% | 61.6% | 41.0% | 2.44% | 10.2% |
| 10–15% | 14,102 | 56.3% | 28.2% | 58.8% | 50.3% | 2.63% | 17.8% |
| 15–20% | 10,115 | 54.0% | 34.2% | 57.1% | 56.3% | 2.76% | 22.3% |
| 20–25% | 6,981 | 52.7% | 38.0% | 57.0% | 57.6% | 3.15% | 26.5% |

Same shape at ≥80 bars (5–10%: 64.8% win / 8.5% stop at 20d; 10–15%:
61.3% / 14.8%) and in 2010+.

**Verdict.** Shallower bases are *safer*, not *bigger*. Under 10% deep
roughly halves the 20-day stop-touch rate versus 10–15% (20% vs 28%), and
the win rate edges up, but mean return and the chance of a +20% move
*rise* with depth. For a trader with a 7% hard stop, the stop rate is the
cost that compounds, so a ≤10% cut is a legitimate "tight" tier — as a
label or a sizing input, not as a gate that discards the 10–15% band (that
band holds the most S-grade breakouts and the larger winners).

Full strategy tables follow.

```
universe: 5484 symbols, cache: ./study-cache

97789 graded breakouts from 5484 symbols (errors: 0)

=== ALL graded breakouts (S/A+/A, above 200MA, ≥100k avg vol) (n=97789) ===
strategy                              win    mean  median    PF  bars   %/mo   stop  exits
fixed10 · 7% stop                   50.6%   0.20%   0.09%  1.10     9  0.46%  18.5%  time 82%, stop 18%
fixed21 · 7% stop                   49.9%   0.54%   0.00%  1.20    17  0.65%  31.6%  time 68%, stop 32%
fixed42 · 7% stop                   45.6%   1.04%  -1.70%  1.30    30  0.72%  44.8%  time 55%, stop 45%
fixed63 · 7% stop                   42.3%   1.54%  -7.00%  1.40    41  0.79%  51.8%  stop 52%, time 48%
fixed126 · 7% stop                  35.3%   2.69%  -7.00%  1.59    67  0.84%  62.5%  stop 62%, time 38%
stop · close<MA20                   37.8%   0.36%  -1.31%  1.16    16  0.47%  12.1%  ma20 88%, stop 12%, cap 0%
stop · close<MA50                   36.0%   1.10%  -2.41%  1.35    34  0.68%  25.3%  ma50 75%, stop 25%, cap 0%
stop · trail 10%                    39.1%   1.57%  -2.97%  1.47    55  0.60%  60.1%  stop 60%, trail 36%, cap 4%
stop · trail 15%                    35.3%   2.80%  -7.00%  1.67    81  0.72%  64.0%  stop 64%, trail 24%, cap 12%
stop · trail 20%                    32.4%   3.73%  -7.00%  1.80    95  0.83%  66.8%  stop 67%, cap 19%, trail 14%
stop · trail15 + MA50               36.5%   0.89%  -2.29%  1.29    33  0.57%  26.3%  ma50 67%, stop 26%, trail 6%, cap 0%
all out +20% · else MA50            36.8%   0.88%  -2.33%  1.29    28  0.66%  25.0%  ma50 60%, stop 25%, target 15%, cap 0%
all out +25% · else MA50            36.4%   0.94%  -2.37%  1.30    30  0.66%  25.1%  ma50 64%, stop 25%, target 11%, cap 0%
half +20% · rest MA50               36.8%   0.99%  -2.33%  1.32    34  0.61%  25.3%  ma50 75%, stop 25%, cap 0%
half +20% · BE stop · MA50          36.8%   0.97%  -2.33%  1.32    34  0.60%  25.0%  ma50 74%, stop 25%, breakeven 1%, cap 0%
half +20% · rest trail 15%          35.5%   2.44%  -7.00%  1.58    81  0.63%  64.0%  stop 64%, trail 24%, cap 12%
half +20% · BE · trail 15%          35.5%   2.44%  -7.00%  1.58    81  0.63%  64.0%  stop 64%, trail 24%, cap 12%
third +20% · rest trail15+MA50      36.5%   0.87%  -2.29%  1.29    33  0.56%  26.3%  ma50 67%, stop 26%, trail 6%, cap 0%
O'Neil: +20% tgt / 8wk / MA50       36.2%   0.99%  -2.41%  1.32    29  0.71%  25.4%  ma50 62%, stop 25%, target 12%, cap 0%
O'Neil + trail 15%                  36.5%   0.84%  -2.29%  1.28    29  0.62%  26.3%  ma50 59%, stop 26%, target 12%, trail 3%, cap 0%

=== grade S (n=4072) ===
strategy                              win    mean  median    PF  bars   %/mo   stop  exits
fixed10 · 7% stop                   55.8%   0.48%   0.49%  1.44    10  1.04%   5.9%  time 94%, stop 6%
fixed21 · 7% stop                   60.6%   0.93%   1.09%  1.60    20  0.99%  13.8%  time 86%, stop 14%
fixed42 · 7% stop                   58.9%   1.56%   1.59%  1.73    37  0.89%  24.2%  time 76%, stop 24%
fixed63 · 7% stop                   56.5%   2.31%   1.68%  1.91    52  0.94%  31.8%  time 68%, stop 32%
fixed126 · 7% stop                  51.0%   3.68%   0.53%  2.10    90  0.86%  44.7%  time 55%, stop 45%
stop · close<MA20                   45.2%   0.75%  -0.36%  1.56    19  0.82%   2.6%  ma20 97%, stop 3%
stop · close<MA50                   45.9%   1.77%  -0.49%  1.91    44  0.85%   8.3%  ma50 92%, stop 8%, cap 0%
stop · trail 10%                    47.2%   3.88%  -0.82%  2.37    99  0.83%  52.1%  stop 52%, trail 36%, cap 12%
stop · trail 15%                    45.6%   5.68%  -2.55%  2.63   133  0.90%  53.2%  stop 53%, cap 28%, trail 18%
stop · trail 20%                    44.4%   7.42%  -6.67%  2.94   145  1.07%  54.2%  stop 54%, cap 39%, trail 7%
stop · trail15 + MA50               45.9%   1.80%  -0.49%  1.93    43  0.87%   8.6%  ma50 90%, stop 9%, trail 1%, cap 0%
all out +20% · else MA50            46.0%   1.68%  -0.48%  1.87    40  0.89%   8.3%  ma50 82%, target 10%, stop 8%, cap 0%
all out +25% · else MA50            46.0%   1.76%  -0.49%  1.91    41  0.90%   8.3%  ma50 85%, stop 8%, target 7%, cap 0%
half +20% · rest MA50               46.0%   1.72%  -0.48%  1.89    44  0.83%   8.3%  ma50 92%, stop 8%, cap 0%
half +20% · BE stop · MA50          46.0%   1.72%  -0.48%  1.89    44  0.83%   8.3%  ma50 91%, stop 8%, breakeven 0%, cap 0%
half +20% · rest trail 15%          45.7%   4.90%  -2.55%  2.41   133  0.78%  53.2%  stop 53%, cap 28%, trail 18%
half +20% · BE · trail 15%          45.7%   4.90%  -2.55%  2.41   133  0.78%  53.2%  stop 53%, cap 28%, trail 18%
third +20% · rest trail15+MA50      45.9%   1.76%  -0.49%  1.91    43  0.85%   8.6%  ma50 90%, stop 9%, trail 1%, cap 0%
O'Neil: +20% tgt / 8wk / MA50       45.9%   1.69%  -0.49%  1.87    40  0.89%   8.4%  ma50 82%, target 10%, stop 8%, cap 0%
O'Neil + trail 15%                  45.9%   1.71%  -0.49%  1.88    40  0.90%   8.6%  ma50 81%, target 10%, stop 9%, trail 0%, cap 0%

=== grade A+ (n=25358) ===
strategy                              win    mean  median    PF  bars   %/mo   stop  exits
fixed10 · 7% stop                   53.5%   0.38%   0.37%  1.23     9  0.83%  12.9%  time 87%, stop 13%
fixed21 · 7% stop                   53.4%   0.68%   0.54%  1.29    18  0.78%  25.6%  time 74%, stop 26%
fixed42 · 7% stop                   49.3%   1.10%  -0.16%  1.36    32  0.71%  39.3%  time 61%, stop 39%
fixed63 · 7% stop                   46.7%   1.63%  -1.71%  1.47    44  0.77%  46.4%  time 54%, stop 46%
fixed126 · 7% stop                  39.7%   2.96%  -7.00%  1.70    74  0.84%  57.9%  stop 58%, time 42%
stop · close<MA20                   41.0%   0.53%  -0.95%  1.27    17  0.64%   7.3%  ma20 93%, stop 7%
stop · close<MA50                   37.9%   1.22%  -1.94%  1.46    36  0.72%  15.5%  ma50 84%, stop 15%, cap 0%
stop · trail 10%                    40.6%   1.99%  -2.55%  1.61    64  0.65%  58.5%  stop 59%, trail 37%, cap 5%
stop · trail 15%                    37.4%   3.45%  -6.36%  1.85    94  0.77%  61.9%  stop 62%, trail 23%, cap 15%
stop · trail 20%                    34.8%   4.40%  -7.00%  1.98   109  0.85%  64.3%  stop 64%, cap 24%, trail 12%
stop · trail15 + MA50               38.0%   1.13%  -1.93%  1.43    35  0.68%  16.3%  ma50 80%, stop 16%, trail 3%, cap 0%
all out +20% · else MA50            38.2%   1.10%  -1.92%  1.41    30  0.76%  15.4%  ma50 71%, stop 15%, target 13%, cap 0%
all out +25% · else MA50            38.0%   1.14%  -1.93%  1.43    32  0.75%  15.4%  ma50 76%, stop 15%, target 9%, cap 0%
half +20% · rest MA50               38.2%   1.16%  -1.92%  1.44    36  0.68%  15.5%  ma50 84%, stop 15%, cap 0%
half +20% · BE stop · MA50          38.2%   1.16%  -1.92%  1.44    36  0.68%  15.4%  ma50 84%, stop 15%, breakeven 0%, cap 0%
half +20% · rest trail 15%          37.5%   3.00%  -6.34%  1.75    94  0.67%  61.9%  stop 62%, trail 23%, cap 15%
half +20% · BE · trail 15%          37.5%   3.00%  -6.34%  1.75    94  0.67%  61.9%  stop 62%, trail 23%, cap 15%
third +20% · rest trail15+MA50      38.0%   1.11%  -1.93%  1.42    35  0.66%  16.3%  ma50 80%, stop 16%, trail 3%, cap 0%
O'Neil: +20% tgt / 8wk / MA50       38.1%   1.14%  -1.93%  1.43    31  0.77%  15.4%  ma50 73%, stop 15%, target 12%, cap 0%
O'Neil + trail 15%                  38.0%   1.08%  -1.93%  1.41    31  0.74%  16.3%  ma50 71%, stop 16%, target 12%, trail 1%, cap 0%

=== grade A (n=68359) ===
strategy                              win    mean  median    PF  bars   %/mo   stop  exits
fixed10 · 7% stop                   49.3%   0.12%   0.00%  1.06     9  0.28%  21.3%  time 79%, stop 21%
fixed21 · 7% stop                   48.0%   0.46%  -0.36%  1.16    17  0.58%  34.9%  time 65%, stop 35%
fixed42 · 7% stop                   43.4%   0.99%  -3.44%  1.27    29  0.72%  48.1%  time 52%, stop 48%
fixed63 · 7% stop                   39.8%   1.46%  -7.00%  1.35    39  0.78%  55.0%  stop 55%, time 45%
fixed126 · 7% stop                  32.8%   2.53%  -7.00%  1.53    64  0.83%  65.3%  stop 65%, time 35%
stop · close<MA20                   36.2%   0.28%  -1.52%  1.11    15  0.38%  14.5%  ma20 85%, stop 15%, cap 0%
stop · close<MA50                   34.8%   1.01%  -2.78%  1.30    33  0.65%  30.0%  ma50 70%, stop 30%, cap 0%
stop · trail 10%                    38.1%   1.28%  -3.22%  1.37    49  0.55%  61.2%  stop 61%, trail 36%, cap 3%
stop · trail 15%                    33.9%   2.39%  -7.00%  1.56    73  0.68%  65.4%  stop 65%, trail 25%, cap 10%
stop · trail 20%                    30.9%   3.26%  -7.00%  1.68    87  0.79%  68.5%  stop 68%, cap 17%, trail 15%
stop · trail15 + MA50               35.4%   0.74%  -2.60%  1.23    31  0.50%  31.1%  ma50 61%, stop 31%, trail 8%, cap 0%
all out +20% · else MA50            35.7%   0.75%  -2.67%  1.23    27  0.59%  29.5%  ma50 55%, stop 30%, target 16%, cap 0%
all out +25% · else MA50            35.2%   0.81%  -2.73%  1.25    28  0.60%  29.7%  ma50 59%, stop 30%, target 11%, cap 0%
half +20% · rest MA50               35.7%   0.88%  -2.68%  1.27    33  0.56%  30.0%  ma50 70%, stop 30%, cap 0%
half +20% · BE stop · MA50          35.7%   0.86%  -2.68%  1.26    33  0.55%  29.5%  ma50 69%, stop 30%, breakeven 1%, cap 0%
half +20% · rest trail 15%          34.1%   2.08%  -7.00%  1.49    73  0.60%  65.4%  stop 65%, trail 25%, cap 10%
half +20% · BE · trail 15%          34.1%   2.08%  -7.00%  1.49    73  0.60%  65.4%  stop 65%, trail 25%, cap 10%
third +20% · rest trail15+MA50      35.4%   0.73%  -2.60%  1.23    31  0.49%  31.1%  ma50 61%, stop 31%, trail 8%, cap 0%
O'Neil: +20% tgt / 8wk / MA50       35.0%   0.89%  -2.79%  1.27    28  0.67%  30.1%  ma50 57%, stop 30%, target 12%, cap 0%
O'Neil + trail 15%                  35.4%   0.70%  -2.60%  1.22    27  0.54%  31.1%  ma50 53%, stop 31%, target 12%, trail 4%, cap 0%

=== 2010–2026 only (n=58414) ===
strategy                              win    mean  median    PF  bars   %/mo   stop  exits
fixed10 · 7% stop                   50.7%   0.08%   0.09%  1.04     9  0.18%  19.1%  time 81%, stop 19%
fixed21 · 7% stop                   49.5%   0.34%  -0.08%  1.12    17  0.42%  32.4%  time 68%, stop 32%
fixed42 · 7% stop                   44.7%   0.70%  -2.15%  1.20    30  0.49%  45.9%  time 54%, stop 46%
fixed63 · 7% stop                   41.4%   1.12%  -7.00%  1.28    41  0.58%  52.9%  stop 53%, time 47%
fixed126 · 7% stop                  34.1%   2.01%  -7.00%  1.43    66  0.64%  63.7%  stop 64%, time 36%
stop · close<MA20                   37.1%   0.17%  -1.34%  1.07    16  0.22%  12.7%  ma20 87%, stop 13%, cap 0%
stop · close<MA50                   35.0%   0.67%  -2.54%  1.21    33  0.43%  25.8%  ma50 74%, stop 26%, cap 0%
stop · trail 10%                    37.3%   1.06%  -3.38%  1.30    55  0.41%  61.8%  stop 62%, trail 35%, cap 3%
stop · trail 15%                    33.3%   2.11%  -7.00%  1.48    80  0.55%  65.9%  stop 66%, trail 22%, cap 12%
stop · trail 20%                    30.4%   2.74%  -7.00%  1.57    92  0.62%  68.7%  stop 69%, cap 19%, trail 13%
stop · trail15 + MA50               35.4%   0.56%  -2.43%  1.18    32  0.37%  26.7%  ma50 68%, stop 27%, trail 6%, cap 0%
all out +20% · else MA50            35.7%   0.58%  -2.47%  1.19    28  0.44%  25.4%  ma50 61%, stop 25%, target 14%, cap 0%
all out +25% · else MA50            35.4%   0.64%  -2.50%  1.20    29  0.46%  25.6%  ma50 65%, stop 26%, target 10%, cap 0%
half +20% · rest MA50               35.7%   0.63%  -2.47%  1.20    33  0.40%  25.8%  ma50 74%, stop 26%, cap 0%
half +20% · BE stop · MA50          35.7%   0.62%  -2.47%  1.20    33  0.39%  25.4%  ma50 73%, stop 25%, breakeven 1%, cap 0%
half +20% · rest trail 15%          33.4%   1.83%  -7.00%  1.42    80  0.48%  65.9%  stop 66%, trail 22%, cap 12%
half +20% · BE · trail 15%          33.4%   1.83%  -7.00%  1.42    80  0.48%  65.9%  stop 66%, trail 22%, cap 12%
third +20% · rest trail15+MA50      35.4%   0.55%  -2.43%  1.18    32  0.36%  26.7%  ma50 68%, stop 27%, trail 6%, cap 0%
O'Neil: +20% tgt / 8wk / MA50       35.2%   0.62%  -2.53%  1.20    29  0.45%  25.9%  ma50 63%, stop 26%, target 11%, cap 0%
O'Neil + trail 15%                  35.4%   0.53%  -2.43%  1.17    28  0.40%  26.7%  ma50 60%, stop 27%, target 11%, trail 3%, cap 0%

=== before 2010 (n=39375) ===
strategy                              win    mean  median    PF  bars   %/mo   stop  exits
fixed10 · 7% stop                   50.4%   0.39%   0.10%  1.20     9  0.88%  17.6%  time 82%, stop 18%
fixed21 · 7% stop                   50.6%   0.83%   0.16%  1.32    18  0.99%  30.3%  time 70%, stop 30%
fixed42 · 7% stop                   46.8%   1.56%  -1.10%  1.47    31  1.06%  43.1%  time 57%, stop 43%
fixed63 · 7% stop                   43.6%   2.16%  -7.00%  1.58    42  1.08%  50.2%  stop 50%, time 50%
fixed126 · 7% stop                  37.2%   3.71%  -7.00%  1.84    70  1.12%  60.7%  stop 61%, time 39%
stop · close<MA20                   39.0%   0.65%  -1.27%  1.29    16  0.84%  11.4%  ma20 89%, stop 11%
stop · close<MA50                   37.6%   1.73%  -2.19%  1.57    35  1.03%  24.6%  ma50 75%, stop 25%, cap 0%
stop · trail 10%                    41.9%   2.34%  -2.30%  1.74    56  0.88%  57.6%  stop 58%, trail 38%, cap 4%
stop · trail 15%                    38.4%   3.83%  -5.95%  1.97    83  0.97%  61.1%  stop 61%, trail 26%, cap 13%
stop · trail 20%                    35.4%   5.20%  -7.00%  2.18    98  1.11%  63.9%  stop 64%, cap 21%, trail 16%
stop · trail15 + MA50               38.1%   1.38%  -2.08%  1.47    34  0.85%  25.8%  ma50 67%, stop 26%, trail 7%, cap 0%
all out +20% · else MA50            38.3%   1.32%  -2.10%  1.44    28  0.97%  24.3%  ma50 59%, stop 24%, target 17%
all out +25% · else MA50            37.9%   1.38%  -2.15%  1.46    30  0.95%  24.5%  ma50 64%, stop 24%, target 12%, cap 0%
half +20% · rest MA50               38.3%   1.52%  -2.10%  1.51    35  0.91%  24.6%  ma50 75%, stop 25%, cap 0%
half +20% · BE stop · MA50          38.3%   1.50%  -2.10%  1.50    35  0.90%  24.3%  ma50 75%, stop 24%, breakeven 1%, cap 0%
half +20% · rest trail 15%          38.5%   3.34%  -5.95%  1.85    83  0.84%  61.1%  stop 61%, trail 26%, cap 13%
half +20% · BE · trail 15%          38.5%   3.34%  -5.95%  1.85    83  0.84%  61.1%  stop 61%, trail 26%, cap 13%
third +20% · rest trail15+MA50      38.1%   1.34%  -2.07%  1.46    34  0.83%  25.8%  ma50 67%, stop 26%, trail 7%, cap 0%
O'Neil: +20% tgt / 8wk / MA50       37.8%   1.54%  -2.19%  1.51    30  1.08%  24.8%  ma50 62%, stop 25%, target 14%
O'Neil + trail 15%                  38.1%   1.29%  -2.08%  1.44    29  0.93%  25.8%  ma50 58%, stop 26%, target 13%, trail 3%
```

```
sky bases above 200MA, depth<=25%: 97789 breakouts
depth  0-5%  all bars   n= 20163  20d: win 56.6% stop 17.5% mean 0.49%   63d: win 61.3% stop 38.2% mean 2.09% reached+20% 8.0%
depth  5-10%  all bars   n= 34763  20d: win 55.3% stop 28.7% mean 0.68%   63d: win 59.0% stop 50.6% mean 2.76% reached+20% 17.0%
depth 10-15%  all bars   n= 21882  20d: win 54.8% stop 36.0% mean 0.77%   63d: win 57.4% stop 57.2% mean 3.14% reached+20% 24.3%
depth 15-20%  all bars   n= 12861  20d: win 53.3% stop 40.4% mean 0.84%   63d: win 55.8% stop 61.2% mean 3.26% reached+20% 27.6%
depth 20-25%  all bars   n=  8120  20d: win 52.2% stop 42.6% mean 1.17%   63d: win 56.0% stop 61.3% mean 3.52% reached+20% 30.8%

depth  0-5%  >=25 bars  n=  2435  20d: win 58.0% stop 10.4% mean 0.57%   63d: win 63.2% stop 27.8% mean 1.66% reached+20% 4.3%
depth  5-10%  >=25 bars  n= 12893  20d: win 57.9% stop 20.0% mean 0.75%   63d: win 61.6% stop 41.0% mean 2.44% reached+20% 10.2%
depth 10-15%  >=25 bars  n= 14102  20d: win 56.3% stop 28.2% mean 0.72%   63d: win 58.8% stop 50.3% mean 2.63% reached+20% 17.8%
depth 15-20%  >=25 bars  n= 10115  20d: win 54.0% stop 34.2% mean 0.65%   63d: win 57.1% stop 56.3% mean 2.76% reached+20% 22.3%
depth 20-25%  >=25 bars  n=  6981  20d: win 52.7% stop 38.0% mean 0.99%   63d: win 57.0% stop 57.6% mean 3.15% reached+20% 26.5%

depth  0-5%  >=80 bars  n=    72  20d: win 61.1% stop 2.8% mean 0.50%   63d: win 56.9% stop 19.4% mean -0.08% reached+20% 6.9%
depth  5-10%  >=80 bars  n=   881  20d: win 64.8% stop 8.5% mean 0.86%   63d: win 65.5% stop 23.8% mean 2.37% reached+20% 4.4%
depth 10-15%  >=80 bars  n=  3119  20d: win 61.3% stop 14.8% mean 0.92%   63d: win 63.0% stop 34.3% mean 2.81% reached+20% 9.1%
depth 15-20%  >=80 bars  n=  4196  20d: win 55.9% stop 22.4% mean 0.69%   63d: win 59.0% stop 44.7% mean 2.37% reached+20% 12.7%
depth 20-25%  >=80 bars  n=  4059  20d: win 53.5% stop 28.8% mean 0.68%   63d: win 58.1% stop 49.5% mean 2.39% reached+20% 17.2%

by grade (production cut):
S  (<=15%, >=80b)   n=  4072  20d: win 62.1% stop 13.3% mean 0.90%   63d: win 63.4% stop 31.8% mean 2.67% reached+20% 8.0%
A+ (<=15%, 25-79b)  n= 25358  20d: win 56.3% stop 24.7% mean 0.69%   63d: win 59.9% stop 46.4% mean 2.44% reached+20% 14.2%
A  (rest <=25%)     n= 68359  20d: win 54.0% stop 34.0% mean 0.72%   63d: win 57.6% stop 55.0% mean 2.99% reached+20% 21.9%

2010+ only:
depth  0-5%  >=25 bars  n=  1460  20d: win 57.9% stop 11.5% mean 0.30%   63d: win 61.2% stop 30.8% mean 0.83% reached+20% 3.4%
depth  5-10%  >=25 bars  n=  7708  20d: win 57.1% stop 20.8% mean 0.54%   63d: win 60.8% stop 42.9% mean 1.92% reached+20% 9.0%
depth 10-15%  >=25 bars  n=  8515  20d: win 55.6% stop 29.3% mean 0.51%   63d: win 57.3% stop 52.3% mean 1.96% reached+20% 16.1%
depth 15-20%  >=25 bars  n=  6067  20d: win 53.1% stop 35.5% mean 0.33%   63d: win 56.3% stop 57.8% mean 2.14% reached+20% 20.7%
depth 20-25%  >=25 bars  n=  4095  20d: win 52.2% stop 39.6% mean 0.86%   63d: win 56.8% stop 59.0% mean 3.03% reached+20% 25.9%
```

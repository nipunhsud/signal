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

## Selection and regime: the two mechanical pieces of the discretionary edge

Two filters were added to the portfolio simulation, invested profile (10
slots, 1% risk, trail 20%), 12 orderings, 1990–2026:

- **Regime** (`--regime 200`): S&P 500 above its 200-day MA. Entries-only,
  or with `--regime-exit` (flatten everything the day it closes below, re-enter
  when back above).
- **Relative strength** (`--rs N`, `--rank-rs`): each trade's 6-month return
  ranked against the whole universe at the start of its month (the scanner's
  `rsRating`, replayed). `--rs 80` is a floor; `--rank-rs` fills free slots
  strongest-first instead of grade-first.

| Filter | CAGR | min–max | Max DD | Sharpe | Trades/yr |
| --- | --- | --- | --- | --- | --- |
| none (baseline) | 9.0% | 5.6–13.6% | 39% | 0.87 | 24 |
| S&P > 200MA, entries only | 8.0% | 6.0–12.7% | 30% | 0.75 | 18 |
| S&P > 200MA, entries + exit | 10.9% | 9.7–11.9% | 21% | 0.94 | 33 |
| S&P > 50MA, entries + exit | 9.9% | 9.3–10.5% | 26% | 0.89 | 70 |
| RS ≥ 80 floor | 9.9% | 8.6–11.5% | 39% | 0.75 | 32 |
| RS ≥ 90 floor | 10.7% | 9.3–12.1% | 47% | 0.69 | 41 |
| rank by RS (no floor) | **14.3%** | 12.8–15.8% | 38% | 0.94 | 39 |
| rank by RS + RS ≥ 80 | 12.7% | 11.7–13.7% | 44% | 0.79 | 44 |
| 200MA entries + RS ≥ 80 + rank | 13.4% | 12.6–14.0% | 39% | 0.85 | 34 |
| **200MA entries + exit + RS ≥ 80 + rank** | **14.1%** | 13.4–14.6% | **26%** | 0.92 | 44 |

2010–2026, same profile: baseline 8.1% / 29% DD; with 200MA exit + RS ≥ 80 +
rank 12.7% (11.4–14.6%) / 29% DD / Sharpe 0.79. Conservative 5-slot profile
with the same filters: 10.5% (from 7.0%).

- **Ranking by strength is the single biggest lever in the whole study.**
  Filling slots strongest-first lifts the book from 9% to 14% a year with
  the same drawdown and a tight seed spread. A floor alone does little; it is
  the *preference* that matters — the same signals, taken in a different order.
- **The regime filter earns its keep only if it also exits.** Blocking
  entries below the 200MA loses good early re-entries (8.0%). Flattening below
  it and re-entering above halves the drawdown (39% → 21%) at a higher return.
- **Together: ~14% a year, 26% max drawdown, Sharpe 0.92, spread 13.4–14.6%.**
  That is the index's return with half its worst drawdown, from a rule set.
- **Same-metric comparison with the championship numbers**, single ordering,
  best filter set: best calendar year +67% (1995), best rolling 12 months
  +99%, worst year −15%, worst rolling 12 months −26%. The MA50-on-A/A+
  variant under the same filters posts a +142% year (2003), a +199% rolling
  12 months, and a −30% year (2025) — the shape of a contest entry, from the
  same book.
- Caveats sharpen here: the RS rank leans on today's listings (survivorship),
  turnover roughly doubles so frictionless fills flatter it more, and
  regime-exit whipsaws are counted but their slippage is not.

```
, invested profile (10 slots, 1% risk, trail 20%), 12 orderings, 1990+
### baseline
stop · trail 20%                       9.0%    5.6%   13.6%       38.8%   45.9%    0.87         24
MA50 on A+/A, trail 20% on S          7.9%    5.8%    9.6%       43.4%   49.0%    0.69         44
### --regime 50
stop · trail 20%                      10.0%    8.8%   11.9%       38.8%   44.4%    0.94         18
MA50 on A+/A, trail 20% on S          7.8%    4.9%    9.0%       41.0%   45.2%    0.74         32
### --regime 200
stop · trail 20%                       8.0%    6.0%   12.7%       29.9%   37.1%    0.75         18
MA50 on A+/A, trail 20% on S          9.2%    7.5%   11.6%       34.7%   43.2%    0.76         33
### --regime 200 --regime-exit
stop · trail 20%                      10.9%    9.7%   11.9%       20.5%   23.1%    0.94         33
MA50 on A+/A, trail 20% on S         12.6%   11.3%   14.2%       21.7%   25.0%    1.05         48
### --regime 50 --regime-exit
stop · trail 20%                       9.9%    9.3%   10.5%       25.8%   31.3%    0.89         70
MA50 on A+/A, trail 20% on S          9.4%    7.9%   10.0%       25.9%   29.2%    0.84         79
### --rs 70
stop · trail 20%                      10.0%    7.3%   12.5%       40.0%   48.8%    0.84         28
MA50 on A+/A, trail 20% on S          8.3%    6.5%   11.2%       46.4%   55.3%    0.61         58
### --rs 80
stop · trail 20%                       9.9%    8.6%   11.5%       39.0%   46.7%    0.75         32
MA50 on A+/A, trail 20% on S         11.3%    7.5%   14.4%       41.4%   47.4%    0.72         60
### --rs 90
stop · trail 20%                      10.7%    9.3%   12.1%       47.0%   54.0%    0.69         41
MA50 on A+/A, trail 20% on S          9.4%    7.7%   11.9%       60.5%   66.8%    0.55         65
### --rank-rs
stop · trail 20%                      14.3%   12.8%   15.8%       37.7%   43.5%    0.94         39
MA50 on A+/A, trail 20% on S         11.2%    9.7%   12.4%       54.1%   60.1%    0.64         71
### --rs 80 --rank-rs
stop · trail 20%                      12.7%   11.7%   13.7%       43.5%   49.0%    0.79         44
MA50 on A+/A, trail 20% on S         13.7%   11.9%   14.9%       63.0%   66.0%    0.71         69
### --regime 200 --rs 80
stop · trail 20%                      10.3%    7.2%   12.4%       33.2%   40.6%    0.81         25
MA50 on A+/A, trail 20% on S         12.4%    9.2%   15.0%       35.5%   40.4%    0.81         49
### --regime 200 --rs 80 --rank-rs
stop · trail 20%                      13.4%   12.6%   14.0%       38.6%   44.3%    0.85         34
MA50 on A+/A, trail 20% on S         16.7%   14.3%   18.6%       41.7%   49.5%    0.86         55
### --regime 50 --rs 90 --rank-rs
stop · trail 20%                      11.8%    9.9%   13.2%       50.0%   52.0%    0.71         37
MA50 on A+/A, trail 20% on S         12.9%   11.7%   13.8%       63.6%   71.8%    0.68         53
### --regime 200 --regime-exit --rs 80 --rank-rs
stop · trail 20%                      14.1%   13.4%   14.6%       25.9%   26.7%    0.92         44
MA50 on A+/A, trail 20% on S         16.9%   14.9%   18.3%       37.6%   42.3%    0.91         66
## same, 2010+
### baseline
stop · trail 20%                       8.1%    4.2%   11.9%       29.1%   39.9%    0.75         23
MA50 on A+/A, trail 20% on S          6.7%    4.3%    9.7%       40.6%   48.3%    0.59         41
### --regime 200
stop · trail 20%                       7.7%    3.9%   16.1%       25.9%   32.4%    0.67         20
MA50 on A+/A, trail 20% on S          8.4%    5.4%   15.4%       31.8%   39.0%    0.64         35
### --rs 80
stop · trail 20%                       7.0%    3.0%   11.2%       31.4%   40.8%    0.55         30
MA50 on A+/A, trail 20% on S          6.8%    3.3%   10.1%       40.4%   47.4%    0.48         60
### --regime 200 --rs 80 --rank-rs
stop · trail 20%                      12.7%   11.4%   14.6%       29.2%   31.0%    0.79         35
MA50 on A+/A, trail 20% on S          9.6%    5.3%   12.3%       41.1%   49.5%    0.53         64
## conservative profile (5 slots) with best filters, 1990+
### baseline
stop · trail 20%                       7.0%    3.6%   12.5%       30.9%   36.0%    0.76         12
MA50 on A+/A, trail 20% on S          5.4%    3.9%    7.2%       37.4%   41.9%    0.55         23
### --regime 200 --rs 80 --rank-rs
stop · trail 20%                      10.5%    8.5%   12.1%       37.3%   43.3%    0.74         22
MA50 on A+/A, trail 20% on S         13.2%   12.0%   15.6%       38.7%   47.9%    0.76         35
```

Per-year returns, single ordering (see the log for the full list):

```
=== 10-slot book, 1% risk/trade (7% stop → 14.3% of equity per position, cap 20%), 1990–2026 ===
rule                                CAGR   maxDD    vol  Sharpe  trades/yr  in mkt  worst yr  best yr  growth of $1
stop · trail 20%                    8.9%   42.7%    11%    0.85         23    100%    -24.2%    56.2%  $18
MA50 on A+/A, trail 20% on S       9.6%   46.6%    12%    0.81         42    100%    -35.2%    40.3%  $22

stop · trail 20%: best rolling 12m 55.8% · worst rolling 12m -40.6%
1991 20%  1992 22%  1993 12%  1994 -6%  1995 35%  1996 4%  1997 22%  1998 4%  1999 -9%  2000 -4%  2001 2%  2002 1%  2003 19%  2004 31%  2005 16%  2006 21%  2007 -5%  2008 -24%  2009 -7%  2010 21%  2011 3%  2012 7%  2013 56%  2014 3%  2015 3%  2016 27%  2017 16%  2018 7%  2019 16%  2020 -3%  2021 21%  2022 -13%  2023 -3%  2024 14%  2025 12%  2026 -3%

MA50 on A+/A, trail 20% on S: best rolling 12m 68.1% · worst rolling 12m -39.9%
1991 26%  1992 14%  1993 12%  1994 -8%  1995 17%  1996 24%  1997 40%  1998 -2%  1999 15%  2000 38%  2001 -2%  2002 -10%  2003 14%  2004 12%  2005 9%  2006 8%  2007 0%  2008 -26%  2009 -14%  2010 18%  2011 5%  2012 12%  2013 32%  2014 5%  2015 -0%  2016 12%  2017 22%  2018 5%  2019 35%  2020 10%  2021 21%  2022 -35%  2023 -3%  2024 32%  2025 15%  2026 8%

CAGR by decade:
rule                               1990s   2000s   2010s   2020s
stop · trail 20%                    9.6%    3.7%   15.0%    2.9%
MA50 on A+/A, trail 20% on S      13.0%    1.6%   14.1%    4.6%
=== 10-slot book, 1% risk/trade (7% stop → 14.3% of equity per position, cap 20%), 1990–2026 ===
rule                                CAGR   maxDD    vol  Sharpe  trades/yr  in mkt  worst yr  best yr  growth of $1
stop · trail 20%                   13.8%   42.1%    16%    0.87         34     94%    -15.2%    66.7%  $79
MA50 on A+/A, trail 20% on S      17.0%   43.8%    20%    0.88         56     91%    -30.3%   142.4%  $199

stop · trail 20%: best rolling 12m 99.1% · worst rolling 12m -26.4%
1991 52%  1992 11%  1993 14%  1994 -11%  1995 67%  1996 40%  1997 27%  1998 4%  1999 38%  2000 34%  2001 -4%  2002 -13%  2003 41%  2004 47%  2005 -12%  2006 -1%  2007 -12%  2008 -9%  2009 9%  2010 1%  2011 -15%  2012 4%  2013 44%  2014 -10%  2015 4%  2016 7%  2017 57%  2018 26%  2019 21%  2020 27%  2021 42%  2022 -7%  2023 -4%  2024 30%  2025 6%  2026 -2%

MA50 on A+/A, trail 20% on S: best rolling 12m 199.3% · worst rolling 12m -35.9%
1991 32%  1992 11%  1993 37%  1994 -10%  1995 79%  1996 34%  1997 17%  1998 24%  1999 31%  2000 57%  2001 0%  2002 -7%  2003 142%  2004 73%  2005 -11%  2006 9%  2007 13%  2008 -7%  2009 -3%  2010 5%  2011 -16%  2012 -0%  2013 84%  2014 9%  2015 -3%  2016 8%  2017 31%  2018 -10%  2019 28%  2020 16%  2021 30%  2022 -2%  2023 3%  2024 16%  2025 -30%  2026 23%

CAGR by decade:
rule                               1990s   2000s   2010s   2020s
stop · trail 20%                   21.9%    6.0%   12.1%   11.7%
MA50 on A+/A, trail 20% on S      23.6%   19.9%   10.7%    6.2%
```

## The time backstop: 90 days is too short for the trail

`TRADE_HOLD_DAYS` was set to 90 as a safety net. With the trail rule that is
not a safety net, it is the exit: the trail's average hold is 95 bars and a
fifth of its trades were still open at the study's 250-bar cap.

| Trail 20% with a cap | Per-trade PF | Mean | Bars | Book, best filters | Book, no filters |
| --- | --- | --- | --- | --- | --- |
| no cap (250-bar study limit) | 1.80 | 3.73% | 95 | 14.1% | 9.0% |
| 270-day cap (189 bars) | 1.69 | 3.14% | 82 | — | — |
| 180-day cap (126 bars) | 1.54 | 2.33% | 65 | 12.6% | 8.2% |
| 90-day cap (63 bars) | 1.37 | 1.42% | 41 | 11.6% | 6.8% |

The trader's default is now **365 days** (≈ the study's 250-bar cap).

```
## per-trade
strategy                              win    mean  median    PF  bars   %/mo   stop  exits
stop · trail 20%                    32.4%   3.73%  -7.00%  1.80    95  0.83%  66.8%  stop 67%, cap 19%, trail 14%
trail 20% · 63-bar cap (90d)        42.7%   1.42%  -6.02%  1.37    41  0.74%  51.6%  stop 52%, time 46%, trail 3%
trail 20% · 126-bar cap (180d)      36.9%   2.33%  -7.00%  1.54    65  0.76%  61.1%  stop 61%, time 32%, trail 7%
trail 20% · 189-bar cap (270d)      34.0%   3.14%  -7.00%  1.69    82  0.81%  64.9%  stop 65%, time 24%, trail 11%
## portfolio, invested profile, best filters, 12 orderings
stop · trail 20%                      14.1%   13.4%   14.6%       25.9%   26.7%    0.92         44
trail 20% · 63-bar cap (90d)          11.6%   10.3%   12.4%       31.7%   40.1%    0.70         67
trail 20% · 126-bar cap (180d)        12.6%   11.5%   13.5%       26.7%   31.5%    0.79         53
## portfolio, invested, no filters
stop · trail 20%                       9.0%    5.6%   13.6%       38.8%   45.9%    0.87         24
trail 20% · 63-bar cap (90d)           6.8%    4.7%    8.7%       45.8%   53.4%    0.61         55
trail 20% · 126-bar cap (180d)         8.2%    6.2%   10.5%       40.7%   47.3%    0.75         35
```

## The dashboard's market-health score as a switch

The dashboard scores the tape 0–100 (trend 50, distribution days 25,
breadth 25; risk-on ≥ 70, caution 45–69, risk-off < 45). That score was
rebuilt over history from ^GSPC/^IXIC and the cached universe
(`build-market-health.js`; 13813 days 1971-11-19 → 2026-09-04 — risk-on 22 % of days, caution 43 %,
risk-off 35 %; the replay reads a few points above the live gauge, which uses
SPY/QQQ and the scanned universe) and tested as an entry floor and an exit
trigger, invested profile with RS ≥ 80 + rank-by-RS:

| Health rule | CAGR 1990+ | Max DD | Sharpe | CAGR 2010+ |
| --- | --- | --- | --- | --- |
| none | 12.7% | 44% | 0.79 | 12.2% |
| enter ≥ 45 (not risk-off) | 14.0% | 41% | 0.87 | — |
| enter ≥ 45, flatten < 45 | **16.0%** | 30% | **0.98** | — |
| enter ≥ 55, flatten < 45 | 11.0% | 33% | 0.75 | 6.3% |
| enter ≥ 70 (risk-on only) | 9.0% | 23% | 0.71 | — |
| enter ≥ 70, flatten < 45 | 5.2% | 30% | 0.47 | 2.5% |
| S&P > 200MA, entries + exit (for reference) | 14.1% | 26% | 0.92 | 12.9% |
| S&P > 200MA exit + health ≥ 55 | 15.0% | 32% | 0.96 | — |

- **"Caution" is not a sell.** A 56/100 tape is where much of the return is
  made; requiring risk-on (≥ 70) cuts the book to 9 % and requiring ≥ 55 to
  11 %. Breakouts that work often start while the gauge is still rebuilding.
- **Risk-off (< 45) is the line.** No new entries below it, and flattening
  below it, is the best full-history result in the study (16 %, Sharpe 0.98).
- **But the S&P 200-day rule is the more robust switch.** Every health-based
  rule degrades sharply after 2010 (55/45 → 6.3 %), while the 200MA rule holds
  (12.9 %). Distribution-day counting and breadth were far more informative
  in the 1990s tape than in the ETF era.

```
## HEALTH thresholds, invested profile, RS>=80 + rank by RS, 12 orderings, 1990+
### --rs 80 --rank-rs
stop · trail 20%                      12.7%   11.7%   13.7%       43.5%   49.0%    0.79         44
trail 20% · 63-bar cap (90d)           8.5%    6.9%   11.3%       50.5%   57.5%    0.51         75
trail 20% · 126-bar cap (180d)         8.5%    7.7%    9.6%       43.8%   48.9%    0.53         56
### --health 45 --rs 80 --rank-rs
stop · trail 20%                      14.0%   13.4%   14.6%       41.2%   42.0%    0.87         33
trail 20% · 63-bar cap (90d)          13.4%   12.7%   14.4%       41.4%   44.4%    0.75         57
trail 20% · 126-bar cap (180d)        14.0%   13.1%   15.0%       43.0%   44.2%    0.82         41
### --health 55 --rs 80 --rank-rs
stop · trail 20%                      11.2%   10.5%   12.2%       38.4%   38.6%    0.76         29
trail 20% · 63-bar cap (90d)          10.3%    9.2%   11.8%       42.5%   45.4%    0.63         50
trail 20% · 126-bar cap (180d)         9.0%    8.3%    9.9%       39.7%   41.1%    0.60         37
### --health 70 --rs 80 --rank-rs
stop · trail 20%                       9.0%    8.7%    9.5%       23.0%   25.7%    0.71         17
trail 20% · 63-bar cap (90d)           6.0%    5.5%    6.7%       28.2%   29.0%    0.51         26
trail 20% · 126-bar cap (180d)         7.3%    7.0%    7.7%       24.6%   25.0%    0.59         21
### --health 45 --health-exit 45 --rs 80 --rank-rs
stop · trail 20%                      16.0%   15.6%   16.7%       30.4%   33.0%    0.98         69
trail 20% · 63-bar cap (90d)          15.2%   14.4%   15.9%       30.3%   32.6%    0.91         78
trail 20% · 126-bar cap (180d)        15.3%   14.9%   15.9%       30.6%   33.4%    0.94         70
### --health 55 --health-exit 45 --rs 80 --rank-rs
stop · trail 20%                      11.0%   10.5%   11.6%       33.0%   35.1%    0.75         55
trail 20% · 63-bar cap (90d)          10.6%   10.0%   11.1%       35.2%   41.3%    0.70         63
trail 20% · 126-bar cap (180d)        11.5%   10.9%   12.0%       32.8%   35.1%    0.77         56
### --health 70 --health-exit 45 --rs 80 --rank-rs
stop · trail 20%                       5.2%    4.6%    5.5%       30.4%   33.2%    0.47         25
trail 20% · 63-bar cap (90d)           4.8%    4.4%    5.0%       29.1%   30.2%    0.45         27
trail 20% · 126-bar cap (180d)         5.0%    4.5%    5.2%       30.5%   33.3%    0.46         25
### --health 70 --health-exit 55 --rs 80 --rank-rs
stop · trail 20%                       3.6%    3.0%    3.9%       26.6%   27.5%    0.37         28
trail 20% · 63-bar cap (90d)           3.0%    2.6%    3.2%       27.1%   28.2%    0.32         30
trail 20% · 126-bar cap (180d)         3.4%    2.9%    3.7%       26.6%   27.5%    0.35         29
### --regime 200 --regime-exit --rs 80 --rank-rs
stop · trail 20%                      14.1%   13.4%   14.6%       25.9%   26.7%    0.92         44
trail 20% · 63-bar cap (90d)          11.6%   10.3%   12.4%       31.7%   40.1%    0.70         67
trail 20% · 126-bar cap (180d)        12.6%   11.5%   13.5%       26.7%   31.5%    0.79         53
### --regime 200 --regime-exit --health 55 --rs 80 --rank-rs
stop · trail 20%                      15.0%   14.2%   15.5%       31.6%   35.3%    0.96         33
trail 20% · 63-bar cap (90d)          12.1%   10.6%   12.7%       36.5%   45.3%    0.74         51
trail 20% · 126-bar cap (180d)        13.4%   12.9%   13.8%       30.5%   33.2%    0.83         40
## same, 2010+
### --rs 80 --rank-rs
stop · trail 20%                      12.2%   10.1%   14.2%       32.1%   35.6%    0.76         43
trail 20% · 63-bar cap (90d)           6.4%    3.9%    8.9%       41.6%   52.0%    0.40         79
trail 20% · 126-bar cap (180d)         7.4%    5.0%   11.1%       35.9%   38.7%    0.46         57
### --health 55 --health-exit 45 --rs 80 --rank-rs
stop · trail 20%                       6.3%    4.7%    7.2%       32.5%   35.1%    0.43         66
trail 20% · 63-bar cap (90d)           5.8%    4.6%    6.7%       35.2%   41.3%    0.40         74
trail 20% · 126-bar cap (180d)         6.1%    4.5%    7.0%       32.5%   35.1%    0.43         66
### --health 70 --health-exit 45 --rs 80 --rank-rs
stop · trail 20%                       2.5%    2.2%    3.1%       30.4%   33.2%    0.25         30
trail 20% · 63-bar cap (90d)           3.2%    2.7%    3.7%       29.1%   30.2%    0.30         31
trail 20% · 126-bar cap (180d)         2.5%    2.2%    3.1%       30.5%   33.3%    0.25         30
### --regime 200 --regime-exit --rs 80 --rank-rs
stop · trail 20%                      12.9%   11.2%   13.7%       25.9%   26.7%    0.79         46
trail 20% · 63-bar cap (90d)           5.8%    3.2%    7.6%       31.7%   40.1%    0.38         74
trail 20% · 126-bar cap (180d)         9.2%    7.6%   10.7%       26.7%   31.5%    0.57         57
```

## Circuit breakers: "stop trading when it isn't working"

Four families of equity-based breakers, added to the simulator and run on
the shipped setup (invested profile, RS-ranked, S&P 200MA switch with exit),
12 orderings, 1990–2026. Columns add the worst calendar year, the number of
years below −10 %, and the share of days the breaker kept the book halted.

| Breaker | CAGR | Max DD | Sharpe | Worst year | Years < −10 % | Halted |
| --- | --- | --- | --- | --- | --- | --- |
| none (shipped setup) | **14.1%** | 26% | 0.92 | −11.6% | 1.0 | 0% |
| halt entries at 10 % drawdown, resume at 5 % | 2.4% | 12% | 0.52 | 0.0% | 0.0 | 88% |
| halt at 15 %, resume at 7.5 % | 4.4% | 17% | 0.68 | −3.6% | 0.3 | 77% |
| halt at 20 %, resume at 10 % | 6.8% | 20% | 0.73 | −9.7% | 0.3 | 53% |
| halt at 15 % and flatten | 3.7% | 15% | 0.63 | −5.2% | 0.0 | 80% |
| trade only while equity > its 50-day MA | 0.9% | 9% | 0.25 | 0.0% | 0.0 | 95% |
| trade only while equity > its 100-day MA | 2.1% | 12% | 0.43 | −5.4% | 0.0 | 89% |
| trade only while equity > its 200-day MA | 4.8% | 18% | 0.72 | −2.6% | 0.2 | 76% |
| pause 20 days after 3 straight losers | 10.2% | 26% | 0.78 | −12.1% | 1.3 | 42% |
| pause 20 days after 5 straight losers | 10.6% | 27% | 0.77 | −13.3% | 1.3 | 30% |
| risk scales to zero at 20 % drawdown | 9.3% | 18% | 0.88 | −9.9% | 0.5 | 0% |
| risk scales to zero at 30 % drawdown | 12.3% | 21% | 0.94 | −11.4% | 0.9 | 0% |
| risk scales to zero at 40 % drawdown | 13.1% | 23% | 0.93 | −11.9% | 1.0 | 0% |

Without the market switch (RS-ranked only): baseline 12.7 % / 44 % DD /
worst year −25 % / 3.7 bad years; every breaker drops it to 2–5 % a year.

- **Equity-curve breakers destroy this strategy.** Its profit arrives in
  bursts after stretches of small stop-outs; a drawdown halt or an
  equity-MA filter switches the book off in exactly those stretches and
  misses the burst that pays for them. The 15 % halt keeps the book idle
  77 % of the time and earns 4.4 %.
- **Loss-streak pauses cost a third of the return and remove no bad years.**
  Streaks of stops are the normal texture of a 35 %-win-rate rule, not a
  signal that something broke.
- **The only breaker that does not hurt is sizing down with drawdown.**
  Scaling risk to zero at 40 % drawdown gives up 1 point of CAGR for 3
  points of max drawdown, at 30 % it is 2 for 5. It never halts, so it never
  misses the recovery. Worth having as a lever, not a default.
- **The deep losing years are already handled by the market switch.** With it,
  the worst year is −11.6 % and one year in 36 lands below −10 %; without
  it, −25 % and nearly four. Breakers cannot substitute for the switch —
  Section B — because they react to the book's own losses, which lag the
  market by weeks; the 200MA reacts to the market itself.
- 2010+ is harsher on breakers still (drawdown halt: −0.5 %, equity-MA: 0.6 %).

```
## A. breakers WITH regime200-exit + RS80 + rank (the shipped setup), 1990+
baseline 14.1%   13.4%   14.6%       25.9%   26.7%    0.92         44    -11.6%       1.0      0%
dd-halt 10 (resume at half) 2.4%    1.5%    3.3%       12.4%   13.5%    0.52          4      0.0%       0.0     88%
dd-halt 15 (resume at half) 4.4%    4.0%    4.9%       16.9%   17.5%    0.68          8     -3.6%       0.3     77%
dd-halt 20 (resume at half) 6.8%    4.1%    7.4%       20.2%   20.3%    0.73         20     -9.7%       0.3     53%
dd-halt 15 + flatten 3.7%    3.2%    4.2%       15.4%   16.6%    0.63          7     -5.2%       0.0     80%
dd-halt 20 + flatten 6.8%    4.1%    7.4%       20.2%   20.3%    0.73         20     -9.7%       0.3     53%
dd-halt 15 resume 5 4.2%    4.0%    4.4%       16.8%   17.5%    0.63         10    -11.6%       0.8     75%
equity > MA50 0.9%    0.1%    2.0%        8.8%   12.3%    0.25          2      0.0%       0.0     95%
equity > MA100 2.1%    1.4%    3.2%       12.3%   17.7%    0.43          4     -5.4%       0.0     89%
equity > MA200 4.8%    4.5%    5.3%       18.4%   21.5%    0.72          9     -2.6%       0.2     76%
streak 3 pause 20d 10.2%    8.5%   12.9%       26.0%   31.3%    0.78         31    -12.1%       1.3     42%
streak 5 pause 20d 10.6%    9.9%   11.4%       27.1%   34.3%    0.77         35    -13.3%       1.3     30%
streak 5 pause 60d 8.5%    5.3%   10.6%       37.4%   49.8%    0.69         27    -13.9%       2.8     55%
scale risk to 0 at dd 20 9.3%    8.8%   10.0%       17.9%   18.4%    0.88         56     -9.9%       0.5      0%
scale risk to 0 at dd 30 12.3%   11.6%   12.8%       21.1%   21.4%    0.94         56    -11.4%       0.9      0%
scale risk to 0 at dd 40 13.1%   12.4%   13.7%       22.9%   23.8%    0.93         55    -11.9%       1.0      0%
dd-halt 15 + scale 30 5.6%    4.4%    6.4%       16.5%   17.2%    0.82         12      0.0%       0.0     75%
eq>MA100 + scale 30 1.5%    0.0%    4.0%        9.3%   15.9%    0.36          4      0.0%       0.0     91%
## B. breakers WITHOUT the market switch (RS80 + rank only) — do they substitute for it?
baseline (no switch) 12.7%   11.7%   13.7%       43.5%   49.0%    0.79         44    -25.0%       3.7      0%
dd-halt 15 1.8%    1.4%    2.3%       19.0%   21.0%    0.39          4     -9.6%       0.5     89%
dd-halt 15 + flatten 1.8%    1.4%    2.3%       15.5%   16.0%    0.41          4     -7.2%       0.0     89%
equity > MA100 3.7%    2.7%    5.5%       23.9%   30.2%    0.51          8    -11.0%       0.5     83%
scale-dd 30 4.8%    2.7%    8.9%       28.4%   28.7%    0.56         28    -18.6%       2.3      0%
eq>MA100 + dd20 flatten 3.0%    1.7%    4.8%       20.3%   22.8%    0.48          6     -7.7%       0.4     86%
## C. 2010+, shipped setup
baseline 12.9%   11.2%   13.7%       25.9%   26.7%    0.79         46    -11.6%       1.0      0%
dd-halt 15 -0.5%   -0.6%   -0.3%       16.5%   18.0%   -0.14          2      0.0%       0.0     97%
equity > MA100 0.6%    0.0%    3.0%       13.3%   18.9%    0.13          3     -2.9%       0.1     94%
scale-dd 30 8.6%    7.2%    9.6%       20.9%   21.4%    0.66         59    -11.4%       0.9      0%
streak 5 pause 20d 5.4%    3.6%    7.1%       27.0%   34.3%    0.42         38    -13.3%       1.3     36%
```

## Rotation: leave when momentum fades, move to the next breakout

The discretionary version of this style does not wait through sideways
tape: it sells when the move stalls and puts the slot into the next
breakout. Tested two ways on the shipped setup (10 slots, S&P 200MA switch,
RS ≥ 80, strongest-first), 12 orderings, now **with a transaction-cost
model** (`--cost` basis points per side; 10 bp ≈ liquid large/mid caps with
a market order, 25 bp ≈ small caps or sloppy fills):

1. **Stall exits** — sell at the next open after N bars without a new closing
   high (N = 10/15/20; one armed only after +10 %; two combined with a trail).
2. **Clock rotation** — fixed 10/21/42-bar holds, as pure turnover references.

| Rule | CAGR 0 bp | CAGR 10 bp | CAGR 25 bp | Max DD | Sharpe (10 bp) | Trades/yr | 2010+ (10 bp) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| trail 20 % (shipped) | 14.1% | 12.9% | 11.0% | 27% | 0.85 | 44 | 11.6% |
| close < MA50 | 17.6% | 15.7% | 12.9% | 39% | 0.85 | 66 | 9.4% |
| fixed 21 bars | 18.1% | 14.9% | 10.2% | 45% | 0.82 | 114 | 10.1% |
| fixed 42 bars | 21.0% | 18.8% | 15.6% | 55% | 0.80 | 77 | 14.5% |
| fixed 10 bars | 14.9% | 10.0% | 3.0% | 68% | 0.61 | 173 | 4.6% |
| stall 15 | 17.0% | 14.8% | 11.5% | 40% | 0.81 | 79 | 10.0% |
| stall 20 | 17.6% | 15.8% | 13.0% | 42% | 0.86 | 66 | 8.0% |
| stall 15, armed after +10 % | 15.4% | — | — | 33% | 0.89 (0 bp) | 67 | — |
| stall 15 + trail 20 % | 13.6% | — | — | 36% | 0.78 (0 bp) | 82 | — |

- **Rotation raises raw return.** With strength-ranked refills, recycling
  the slot every one to two months beats holding through the trail:
  fixed-42 earns 21 % before costs against 14 %. Your instinct is right
  that the *next* strong name is worth more than a stalled one.
- **The stall signal itself carries no information.** "No new high in 15–20
  days" performs like a plain 15–20-day clock. The gain comes from
  redeploying into the current top-RS breakout, not from detecting the fade.
- **Costs and drawdown eat most of it.** Turnover is two to four times the
  trail's. At 10 bp a side fixed-21 loses 3 points and fixed-10 collapses;
  the fast rules' worst drawdowns run 45–68 % against the trail's 27 %, and
  their worst years are −15 to −33 %. Fixed-42 keeps the CAGR lead (18.8 %
  at 10 bp, 14.5 % after 2010) but at a 55 % drawdown.
- **After 2010, at realistic cost, the trail is the best risk-adjusted rule**
  (11.6 %, Sharpe 0.72, 27 % DD); only fixed-42 beats it on return.

**Recommendation.** Keep the trail as the default. `TRADE_PROFILE=rotation`
is the growth-first book: 7 % stop, no trail, sell after 60 calendar days
(≈ 42 bars), strongest-first refills — ~19 % a year at 10 bp with a 55 %
worst drawdown. That drawdown is the price of the extra 6 points, and it is
what turns a contest-style year into a contest-style loss.

```
## per-trade (all graded)
strategy                              win    mean  median    PF  bars   %/mo   stop  exits
fixed21 · 7% stop                   49.9%   0.54%   0.00%  1.20    17  0.65%  31.6%  time 68%, stop 32%
stop · close<MA20                   37.8%   0.36%  -1.31%  1.16    16  0.47%  12.1%  ma20 88%, stop 12%, cap 0%
stop · close<MA50                   36.0%   1.10%  -2.41%  1.35    34  0.68%  25.3%  ma50 75%, stop 25%, cap 0%
stop · trail 10%                    39.1%   1.57%  -2.97%  1.47    55  0.60%  60.1%  stop 60%, trail 36%, cap 4%
stop · trail 20%                    32.4%   3.73%  -7.00%  1.80    95  0.83%  66.8%  stop 67%, cap 19%, trail 14%
trail 20% · 63-bar cap (90d)        42.7%   1.42%  -6.02%  1.37    41  0.74%  51.6%  stop 52%, time 46%, trail 3%
trail 20% · 126-bar cap (180d)      36.9%   2.33%  -7.00%  1.54    65  0.76%  61.1%  stop 61%, time 32%, trail 7%
trail 20% · 189-bar cap (270d)      34.0%   3.14%  -7.00%  1.69    82  0.81%  64.9%  stop 65%, time 24%, trail 11%
stall 10 · 7% stop                  43.3%   0.55%  -0.84%  1.21    20  0.58%  25.4%  stall10 75%, stop 25%, cap 0%
stall 15 · 7% stop                  42.1%   0.84%  -1.39%  1.27    29  0.62%  34.4%  stall15 66%, stop 34%, cap 0%
stall 20 · 7% stop                  41.0%   1.24%  -2.13%  1.36    37  0.71%  40.9%  stall20 59%, stop 41%, cap 0%
stall 15 after +10%                 41.9%   1.72%  -7.00%  1.42    55  0.66%  56.1%  stop 56%, stall15 42%, cap 2%
stall 15 + trail 20%                42.1%   0.77%  -1.36%  1.25    28  0.57%  34.5%  stall15 64%, stop 34%, trail 2%, cap 0%
stall 10 + trail 15%                43.2%   0.44%  -0.84%  1.18    20  0.48%  26.0%  stall10 71%, stop 26%, trail 3%, cap 0%
## portfolio: invested, regime200-exit + RS80 + rank, 12 orderings, 1990+
=== 12 orderings · 10 slots · 1% risk · 1990– · S&P>200MA (exit too) · RS>=80 · rank by RS ===
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     18.1%   17.2%   19.4%       37.6%   47.3%    0.97        114    -11.1%       0.6      0%
stop · close<MA50                     17.6%   15.8%   19.2%       37.6%   42.3%    0.93         66    -19.9%       2.7      0%
stop · trail 20%                      14.1%   13.4%   14.6%       25.9%   26.7%    0.92         44    -11.6%       1.0      0%
stop · close<MA20                     12.9%   11.8%   13.8%       36.7%   46.8%    0.73        108     -9.9%       0.4      0%
stop · trail 10%                      11.6%   10.7%   12.8%       33.0%   35.7%    0.79         79    -13.4%       1.2      0%
stall 10 · 7% stop                    14.9%   13.9%   16.0%       50.2%   53.5%    0.81        102    -15.0%       2.4      0%
stall 15 · 7% stop                    17.0%   15.1%   18.3%       38.3%   45.0%    0.91         79    -24.6%       2.7      0%
stall 20 · 7% stop                    17.6%   16.8%   18.6%       40.5%   45.8%    0.94         66    -15.9%       2.8      0%
stall 15 after +10%                   15.4%   14.1%   16.6%       33.1%   36.9%    0.89         67    -15.1%       2.1      0%
stall 15 + trail 20%                  13.6%   12.1%   14.7%       35.9%   40.9%    0.78         82    -27.0%       3.0      0%
stall 10 + trail 15%                  11.3%   10.2%   12.3%       51.0%   56.7%    0.68        107    -16.4%       2.3      0%
## portfolio: same, 2010+
=== 12 orderings · 10 slots · 1% risk · 2010– · S&P>200MA (exit too) · RS>=80 · rank by RS ===
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     13.5%   11.3%   15.1%       37.6%   47.3%    0.70        126    -10.9%       0.6      0%
stop · close<MA50                     11.4%    9.3%   14.2%       37.6%   42.3%    0.62         73    -19.9%       2.7      0%
stop · trail 20%                      12.9%   11.2%   13.7%       25.9%   26.7%    0.79         46    -11.6%       1.0      0%
stop · close<MA20                      7.7%    5.9%    9.2%       36.8%   46.8%    0.46        120     -9.9%       0.4      0%
stop · trail 10%                       7.6%    6.4%    9.4%       33.0%   35.7%    0.53         88    -13.4%       1.2      0%
stall 10 · 7% stop                     8.4%    6.4%   10.8%       50.2%   53.5%    0.48        109    -15.0%       2.4      0%
stall 15 · 7% stop                    12.2%    9.2%   14.2%       38.3%   45.0%    0.66         83    -24.6%       2.7      0%
stall 20 · 7% stop                     9.9%    8.4%   10.7%       40.5%   45.8%    0.55         71    -15.9%       2.8      0%
stall 15 after +10%                    9.6%    7.0%   11.2%       33.1%   36.9%    0.57         72    -15.1%       2.1      0%
stall 15 + trail 20%                  11.8%    9.9%   13.4%       35.9%   40.9%    0.66         87    -27.0%       3.0      0%
stall 10 + trail 15%                   7.5%    5.9%    9.0%       51.0%   56.7%    0.46        115    -16.4%       2.3      0%
## portfolio: rank-rs only (no floor), regime exit, 1990+
=== 12 orderings · 10 slots · 1% risk · 1990– · S&P>200MA (exit too) · rank by RS ===
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     13.8%   12.5%   14.9%       37.5%   49.8%    0.81        117    -14.9%       1.3      0%
stop · close<MA50                     15.3%   14.0%   16.6%       33.7%   38.5%    0.87         68    -18.2%       3.3      0%
stop · trail 20%                      14.8%   14.0%   15.4%       26.5%   27.6%    1.00         44    -17.7%       2.0      0%
stop · close<MA20                     12.3%   11.5%   13.3%       33.6%   41.2%    0.72        113    -14.6%       2.3      0%
stop · trail 10%                       9.5%    8.6%   10.5%       35.0%   37.5%    0.72         74    -17.2%       1.0      0%
stall 10 · 7% stop                    13.7%   12.4%   14.2%       51.3%   54.4%    0.77        103    -18.1%       1.8      0%
stall 15 · 7% stop                    15.5%   14.0%   16.3%       39.8%   45.0%    0.86         80    -21.6%       2.9      0%
stall 20 · 7% stop                    15.1%   13.8%   16.3%       37.3%   41.7%    0.86         67    -18.3%       5.0      0%
stall 15 after +10%                   14.1%   13.2%   14.9%       33.4%   37.1%    0.85         65    -18.6%       2.9      0%
stall 15 + trail 20%                  14.7%   13.2%   15.9%       34.4%   40.6%    0.85         83    -24.7%       3.9      0%
stall 10 + trail 15%                  10.0%    9.2%   10.7%       43.5%   51.5%    0.63        110    -17.7%       2.3      0%
## portfolio: 5 slots, regime200-exit + RS80 + rank, 1990+
=== 12 orderings · 5 slots · 1% risk · 1990– · S&P>200MA (exit too) · RS>=80 · rank by RS ===
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     12.2%   11.1%   13.3%       41.0%   51.0%    0.81         74    -17.6%       1.3      0%
stop · close<MA50                     13.2%   12.0%   14.6%       30.4%   39.2%    0.81         45    -15.8%       4.4      0%
stop · trail 20%                      10.1%    9.2%   11.1%       24.2%   26.1%    0.77         31    -14.1%       1.9      0%
stop · close<MA20                      7.9%    7.0%    8.9%       38.4%   41.1%    0.54         72    -16.1%       3.0      0%
stop · trail 10%                       9.2%    8.2%   10.4%       25.8%   30.4%    0.74         53    -11.8%       1.0      0%
stall 10 · 7% stop                    11.3%   10.5%   12.2%       47.8%   55.9%    0.73         65    -15.4%       2.2      0%
stall 15 · 7% stop                    12.7%   11.7%   13.9%       33.9%   40.9%    0.80         51    -19.1%       2.5      0%
stall 20 · 7% stop                    14.9%   14.0%   15.7%       35.7%   42.2%    0.90         44    -13.8%       3.3      0%
stall 15 after +10%                   10.8%    9.1%   12.0%       32.0%   44.2%    0.73         44    -15.7%       2.9      0%
stall 15 + trail 20%                   9.8%    8.3%   12.1%       34.1%   38.8%    0.67         53    -22.9%       2.7      0%
stall 10 + trail 15%                   7.4%    6.6%    8.5%       52.8%   65.8%    0.55         69    -18.6%       2.7      0%
```

```
## cost 0bp/side · 1990+
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     18.1%   17.2%   19.4%       37.6%   47.3%    0.97        114    -11.1%       0.6      0%
stop · close<MA50                     17.6%   15.8%   19.2%       37.6%   42.3%    0.93         66    -19.9%       2.7      0%
stop · trail 20%                      14.1%   13.4%   14.6%       25.9%   26.7%    0.92         44    -11.6%       1.0      0%
fixed10 · 7% stop                     14.9%   13.8%   15.7%       61.3%   70.7%    0.85        174    -29.3%       2.4      0%
fixed42 · 7% stop                     21.0%   19.9%   22.2%       54.4%   55.7%    0.88         78    -12.6%       1.4      0%
stall 15 · 7% stop                    17.0%   15.1%   18.3%       38.3%   45.0%    0.91         79    -24.6%       2.7      0%
stall 20 · 7% stop                    17.6%   16.8%   18.6%       40.5%   45.8%    0.94         66    -15.9%       2.8      0%
## cost 10bp/side · 1990+
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     14.9%   14.0%   16.1%       44.6%   54.4%    0.82        114    -13.4%       1.1      0%
stop · close<MA50                     15.7%   13.9%   17.3%       39.2%   43.9%    0.85         66    -21.6%       3.6      0%
stop · trail 20%                      12.9%   12.1%   13.3%       27.2%   28.3%    0.85         44    -12.8%       1.5      0%
fixed10 · 7% stop                     10.0%    9.0%   10.8%       68.4%   76.2%    0.61        173    -33.0%       3.7      0%
fixed42 · 7% stop                     18.8%   17.7%   19.9%       55.2%   59.1%    0.80         77    -13.9%       1.7      0%
stall 15 · 7% stop                    14.8%   12.9%   16.1%       40.4%   46.6%    0.81         79    -26.5%       2.8      0%
stall 20 · 7% stop                    15.8%   15.0%   16.7%       41.7%   47.1%    0.86         66    -18.0%       2.9      0%
## cost 25bp/side · 1990+
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     10.2%    9.3%   11.4%       54.2%   62.9%    0.60        114    -17.9%       2.8      0%
stop · close<MA50                     12.9%   11.1%   14.5%       41.6%   46.2%    0.72         66    -23.9%       5.8      0%
stop · trail 20%                      11.0%   10.3%   11.4%       29.6%   31.0%    0.74         44    -14.7%       2.4      0%
fixed10 · 7% stop                      3.0%    2.0%    3.7%       76.9%   82.7%    0.25        173    -38.2%       6.8      0%
fixed42 · 7% stop                     15.6%   14.5%   16.6%       60.1%   64.8%    0.69         77    -16.0%       2.2      0%
stall 15 · 7% stop                    11.5%    9.7%   12.8%       44.4%   51.1%    0.66         79    -29.1%       3.2      0%
stall 20 · 7% stop                    13.0%   12.2%   13.9%       43.4%   49.2%    0.73         66    -21.3%       3.8      0%
## cost 10bp/side · 2010+
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     10.1%    8.0%   11.6%       44.6%   54.4%    0.56        126    -13.4%       1.1      0%
stop · close<MA50                      9.4%    7.3%   12.2%       39.2%   43.9%    0.53         73    -21.6%       3.6      0%
stop · trail 20%                      11.6%    9.9%   12.4%       27.2%   28.3%    0.72         46    -12.8%       1.5      0%
fixed10 · 7% stop                      4.6%    3.4%    6.4%       68.4%   76.2%    0.32        193    -33.0%       3.3      0%
fixed42 · 7% stop                     14.5%   13.0%   15.6%       55.2%   59.1%    0.58         84    -13.9%       1.7      0%
stall 15 · 7% stop                    10.0%    7.1%   12.0%       40.4%   46.6%    0.57         83    -26.5%       2.8      0%
stall 20 · 7% stop                     8.0%    6.4%    8.8%       41.7%   47.1%    0.47         71    -18.0%       2.8      0%
## cost 10bp/side · 1990+ · 5 slots
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                      9.9%    8.8%   10.9%       46.6%   56.1%    0.67         74    -19.7%       1.9      0%
stop · close<MA50                     11.8%   10.6%   13.2%       32.5%   43.2%    0.74         45    -17.2%       5.4      0%
stop · trail 20%                       9.1%    8.2%   10.1%       25.3%   27.7%    0.70         31    -15.2%       2.1      0%
fixed10 · 7% stop                      7.7%    6.6%    8.8%       63.7%   71.7%    0.56        114    -26.6%       4.4      0%
fixed42 · 7% stop                     12.0%   10.8%   13.2%       43.9%   48.2%    0.76         50    -13.8%       1.5      0%
stall 15 · 7% stop                    11.1%   10.1%   12.2%       35.8%   44.0%    0.71         51    -20.7%       3.0      0%
stall 20 · 7% stop                    13.5%   12.6%   14.3%       36.9%   43.3%    0.82         44    -15.3%       4.0      0%
```

### Replacement rotation: swap a laggard only when a stronger signal is waiting

The closest mechanical version of "as it loses momentum, move to the next
breakout": when every slot is full and a new candidate passes the filters,
sell the weakest position that has been held at least N bars and sits below
+X %, and put the slot into the newcomer (at most two swaps a day, 10 bp a
side). On the shipped trail rule, 1990+: none 12.9 % · swap after 10 bars
below 0 % 13.0 % · after 20 below 0 % 13.1 % · after 20 below +5 % 13.1 % ·
after 30 below +10 % 12.4 %. Drawdown and Sharpe unchanged. After 2010:
11.6 % → 12.0–12.1 %. On the fixed-42 clock it is neutral to negative.

**Swapping laggards adds nothing.** A position that is flat after a month
recovers about as often as it fails, and the trail already frees the ones
that break. The turnover that pays is the clock, not the fade signal — and
the clock pays in drawdown.

```
## replacement rotation on trail 20% (and fixed42 ref), cost 10bp, 1990+
### none
stop · trail 20%                      12.9%   12.1%   13.3%       27.2%   28.3%    0.85         44    -12.8%       1.5      0%
fixed42 · 7% stop                     18.8%   17.7%   19.9%       55.2%   59.1%    0.80         77    -13.9%       1.7      0%
### --swap-after 10 --swap-below 0
stop · trail 20%                      13.0%   12.0%   13.5%       27.2%   28.4%    0.85         46    -11.4%       1.3      0%
fixed42 · 7% stop                     18.3%   16.6%   20.2%       54.0%   59.9%    0.84         81    -14.4%       1.8      0%
### --swap-after 10 --swap-below 5
stop · trail 20%                      12.9%   12.4%   13.3%       28.6%   34.0%    0.84         47    -13.6%       1.7      0%
fixed42 · 7% stop                     16.6%   13.6%   19.6%       59.4%   69.3%    0.77         87    -16.5%       2.2      0%
### --swap-after 20 --swap-below 0
stop · trail 20%                      13.1%   12.1%   13.8%       27.3%   28.3%    0.86         45    -12.3%       1.3      0%
fixed42 · 7% stop                     19.2%   17.7%   20.7%       54.9%   56.4%    0.82         78    -14.2%       1.7      0%
### --swap-after 20 --swap-below 5
stop · trail 20%                      13.1%   12.5%   13.6%       28.1%   31.4%    0.85         45    -11.7%       1.2      0%
fixed42 · 7% stop                     18.5%   16.4%   19.6%       55.8%   58.6%    0.79         80    -14.4%       1.8      0%
### --swap-after 30 --swap-below 10
stop · trail 20%                      12.4%   11.6%   13.1%       28.0%   31.2%    0.82         46    -14.4%       1.7      0%
fixed42 · 7% stop                     18.9%   17.0%   20.1%       55.4%   61.9%    0.81         79    -14.8%       1.7      0%
## replacement rotation on trail 20% (and fixed42 ref), cost 10bp, 2010+
### none
stop · trail 20%                      11.6%    9.9%   12.4%       27.2%   28.3%    0.72         46    -12.8%       1.5      0%
fixed42 · 7% stop                     14.5%   13.0%   15.6%       55.2%   59.1%    0.58         84    -13.9%       1.7      0%
### --swap-after 10 --swap-below 0
stop · trail 20%                      11.7%    9.7%   12.8%       27.2%   28.4%    0.72         49    -11.4%       1.3      0%
fixed42 · 7% stop                     12.6%    7.6%   15.0%       54.0%   59.9%    0.55         89    -14.4%       1.8      0%
### --swap-after 10 --swap-below 5
stop · trail 20%                      11.7%   10.6%   12.6%       28.6%   34.0%    0.72         53    -13.6%       1.7      0%
fixed42 · 7% stop                     11.2%    6.2%   16.4%       59.4%   69.3%    0.50         95    -16.5%       2.2      0%
### --swap-after 20 --swap-below 0
stop · trail 20%                      12.0%    9.8%   13.2%       27.3%   28.3%    0.74         48    -12.3%       1.3      0%
fixed42 · 7% stop                     14.9%   13.8%   16.5%       54.9%   56.4%    0.59         85    -14.2%       1.7      0%
### --swap-after 20 --swap-below 5
stop · trail 20%                      12.1%   10.7%   13.3%       28.1%   31.4%    0.74         49    -11.7%       1.2      0%
fixed42 · 7% stop                     13.6%   12.1%   14.8%       55.8%   58.6%    0.55         88    -14.4%       1.8      0%
### --swap-after 30 --swap-below 10
stop · trail 20%                      10.8%    9.1%   12.1%       28.0%   31.2%    0.68         51    -14.4%       1.7      0%
fixed42 · 7% stop                     13.8%   11.8%   15.5%       55.4%   61.9%    0.56         86    -14.8%       1.7      0%
```

## Capping the rotation book's downside

The rotation profile prints the contest-style years and a 55 % drawdown.
Four ways to cap the downside were tested on it (and on the default trail
book for reference), 10 bp a side, 12 orderings:

- **Streak budget** — consecutive losses spend a 2.5 % (or 4 %) budget; the
  next trade may only risk what is left; a winner resets it, and so does a
  10/20/40-day pause (without the pause the rule deadlocks: no trades, no
  winner, no reset).
- **Heat cap** — total open risk-to-stop ≤ 2.5 % or 5 % of equity.
- **Rolling loss cap** — realized losses over the last 10/20 days ≥ 2.5 % or
  5 % block new entries.
- **Smaller risk per trade** — 0.75 % and 0.5 %.

| Rotation book (fixed 42, 10 slots) | CAGR | Max DD | Worst year | Years < −10 % | 2010+ CAGR |
| --- | --- | --- | --- | --- | --- |
| none | 18.8% | 55% | −14% | 1.7 | 14.5% |
| streak budget 2.5 %, 10-day refill | 11.2% | 53% | −27% | 3.0 | 3.2% |
| streak budget 2.5 %, 20-day refill | 9.5% | 44% | −18% | 3.6 | 0.7% |
| streak budget 4 %, 20-day refill | 9.9% | 37% | −18% | 4.5 | 1.3% |
| heat cap 5 % | 11.9% | 45% | −14% | 1.4 | 6.1% |
| heat cap 2.5 % | 7.3% | 30% | −8% | 0.0 | 4.1% |
| rolling loss cap 2.5 % / 20 d | 10.5% | 50% | −17% | 2.3 | 4.3% |
| risk 0.75 % | 16.1% | 51% | −15% | 1.0 | — |
| risk 0.5 % | 11.7% | 43% | −11% | 1.0 | — |
| *default book, trail 20 %, no cap* | 12.9% | 27% | −13% | 1.5 | 11.6% |

- **The consecutive-loss budget caps the upside, not the downside.** It cuts
  the rotation book from 18.8 % to 9.5–11 %, leaves the drawdown at 44–53 %,
  and makes the worst year *worse* (−27 %). After 2010 it drives the book to
  0–3 %. The reason is the shape of the losses: they arrive in clusters when
  the market turns and several momentum positions stop out together; the
  budget then keeps the book out for exactly the rebound that pays. Same
  lesson as the equity-curve breakers, at a smaller scale.
- **Only exposure reduces the drawdown, and it costs return one for one.**
  Heat cap 2.5 % reaches a 30 % drawdown by shrinking the book to two
  positions — 7.3 % a year, which is the conservative profile with worse
  numbers. Halving risk per trade takes 7 points of return for 12 of
  drawdown.
- **The rotation book's drawdown is structural.** Ten fully-invested,
  strength-ranked momentum names are one bet on the same factor; when it
  turns, no per-trade rule helps, because the trades are not independent.
- **The capped version of rotation already exists: it is the default book.**
  Trail 20 % at 12.9 % / 27 % DD beats every capped rotation variant on every
  downside measure while keeping two-thirds of the uncapped return.

Nothing here is added to the trader.

```
## downside caps · rotation (fixed42) and default (trail 20%) · cost 10bp · 1990+
### none
stop · trail 20%                      12.9%   12.1%   13.3%       27.2%   28.3%    0.85         44    -12.8%       1.5      0%
fixed42 · 7% stop                     18.8%   17.7%   19.9%       55.2%   59.1%    0.80         77    -13.9%       1.7      0%
### --streak-budget 2.5
stop · trail 20%                      -0.2%   -0.2%   -0.2%        6.4%    6.8%   -0.40          0      0.0%       0.0      0%
fixed42 · 7% stop                     -0.2%   -0.2%   -0.2%        6.4%    6.8%   -0.40          0      0.0%       0.0      0%
### --streak-budget 4
stop · trail 20%                      -0.2%   -0.2%   -0.2%        6.4%    6.8%   -0.40          0      0.0%       0.0      0%
fixed42 · 7% stop                     -0.2%   -0.2%   -0.2%        6.4%    6.8%   -0.40          0      0.0%       0.0      0%
### --heat 2.5
stop · trail 20%                       7.2%    6.1%    7.7%       18.1%   23.1%    0.81         21    -12.1%       0.7      0%
fixed42 · 7% stop                      7.3%    6.7%    7.9%       29.5%   35.6%    0.73         31     -8.3%       0.0      0%
### --heat 5
stop · trail 20%                      10.2%    9.1%   11.2%       25.4%   27.6%    0.78         40    -11.9%       1.1      0%
fixed42 · 7% stop                     11.9%   10.7%   14.2%       45.4%   50.7%    0.76         60    -13.7%       1.4      0%
### --period-loss 2.5 --period 20
stop · trail 20%                      12.6%   11.4%   13.8%       34.5%   45.3%    0.86         38    -17.8%       2.3     14%
fixed42 · 7% stop                     10.5%    8.3%   13.8%       50.3%   67.7%    0.69         58    -16.8%       2.3     32%
### --period-loss 5 --period 20
stop · trail 20%                      12.3%   11.8%   13.0%       28.1%   29.7%    0.81         43    -11.8%       1.4      3%
fixed42 · 7% stop                     16.5%   13.9%   19.6%       52.7%   63.1%    0.91         71    -18.1%       3.8     12%
### --period-loss 2.5 --period 10
stop · trail 20%                      12.6%   11.4%   14.0%       27.6%   30.2%    0.84         42    -13.2%       1.4      5%
fixed42 · 7% stop                     13.9%   11.9%   15.5%       38.1%   48.9%    0.82         67    -18.8%       3.3     15%
### --streak-budget 2.5 --scale-dd 40
stop · trail 20%                      -0.2%   -0.2%   -0.2%        6.4%    6.8%   -0.40          0      0.0%       0.0      0%
fixed42 · 7% stop                     -0.2%   -0.2%   -0.2%        6.4%    6.8%   -0.40          0      0.0%       0.0      0%
### --risk 0.5
stop · trail 20%                      12.9%   12.1%   13.3%       27.2%   28.3%    0.85         44    -12.8%       1.5      0%
fixed42 · 7% stop                     18.8%   17.7%   19.9%       55.2%   59.1%    0.80         77    -13.9%       1.7      0%
### --risk 0.75 --heat 5
stop · trail 20%                      10.2%    9.1%   11.2%       25.4%   27.6%    0.78         40    -11.9%       1.1      0%
fixed42 · 7% stop                     11.9%   10.7%   14.2%       45.4%   50.7%    0.76         60    -13.7%       1.4      0%
## downside caps · rotation (fixed42) and default (trail 20%) · cost 10bp · 2010+
### none
stop · trail 20%                      11.6%    9.9%   12.4%       27.2%   28.3%    0.72         46    -12.8%       1.5      0%
fixed42 · 7% stop                     14.5%   13.0%   15.6%       55.2%   59.1%    0.58         84    -13.9%       1.7      0%
### --streak-budget 2.5
stop · trail 20%                      -0.5%   -0.5%   -0.5%        9.5%    9.5%   -0.29          0      0.0%       0.0      0%
fixed42 · 7% stop                     -0.6%   -0.6%   -0.6%       13.8%   13.8%   -0.19          1      0.0%       0.0      0%
### --streak-budget 4
stop · trail 20%                      -0.5%   -0.5%   -0.5%        9.5%    9.5%   -0.29          0      0.0%       0.0      0%
fixed42 · 7% stop                     -0.6%   -0.6%   -0.6%       13.8%   13.8%   -0.19          1      0.0%       0.0      0%
### --heat 2.5
stop · trail 20%                       6.8%    6.1%    7.5%       13.5%   15.3%    0.74         22     -6.2%       0.0      0%
fixed42 · 7% stop                      4.1%    2.7%    4.7%       29.5%   35.6%    0.42         33     -8.3%       0.0      0%
### --heat 5
stop · trail 20%                       8.6%    6.7%   10.3%       25.4%   27.6%    0.62         42    -11.9%       1.1      0%
fixed42 · 7% stop                      6.1%    3.8%    9.2%       45.4%   50.7%    0.41         65    -13.7%       1.4      0%
### --period-loss 2.5 --period 20
stop · trail 20%                       7.9%    6.1%   10.9%       34.5%   45.3%    0.54         40    -17.8%       2.3     18%
fixed42 · 7% stop                      4.3%   -0.8%    9.9%       50.3%   67.7%    0.32         61    -16.8%       2.0     38%
### --period-loss 5 --period 20
stop · trail 20%                       9.7%    8.6%   11.1%       27.7%   29.7%    0.62         46    -11.8%       1.4      3%
fixed42 · 7% stop                      7.6%    3.3%   12.1%       52.7%   63.1%    0.46         76    -18.1%       3.8     16%
### --period-loss 2.5 --period 10
stop · trail 20%                       8.7%    7.3%   10.2%       27.6%   30.2%    0.58         44    -13.2%       1.4      7%
fixed42 · 7% stop                      5.5%    2.6%    7.4%       38.1%   48.9%    0.38         72    -18.8%       3.3     19%
### --streak-budget 2.5 --scale-dd 40
stop · trail 20%                      -0.5%   -0.5%   -0.5%        9.5%    9.5%   -0.29          0      0.0%       0.0      0%
fixed42 · 7% stop                     -0.6%   -0.7%   -0.6%       12.8%   12.9%   -0.23          2      0.0%       0.0      0%
### --risk 0.5
stop · trail 20%                      11.6%    9.9%   12.4%       27.2%   28.3%    0.72         46    -12.8%       1.5      0%
fixed42 · 7% stop                     14.5%   13.0%   15.6%       55.2%   59.1%    0.58         84    -13.9%       1.7      0%
### --risk 0.75 --heat 5
stop · trail 20%                       8.6%    6.7%   10.3%       25.4%   27.6%    0.62         42    -11.9%       1.1      0%
fixed42 · 7% stop                      6.1%    3.8%    9.2%       45.4%   50.7%    0.41         65    -13.7%       1.4      0%
```

```
## streak budget with time refill · cost 10bp · 1990+
### --risk 1
stop · trail 20%                      12.9%   12.1%   13.3%       27.2%   28.3%    0.85         44    -12.8%       1.5      0%
fixed42 · 7% stop                     18.8%   17.7%   19.9%       55.2%   59.1%    0.80         77    -13.9%       1.7      0%
### --risk 1 --streak-budget 2.5 --pause 10
stop · trail 20%                      11.9%   10.7%   12.6%       31.5%   33.3%    0.78         38    -15.1%       1.3      0%
fixed42 · 7% stop                     11.2%   10.3%   12.7%       52.6%   63.0%    0.64         64    -26.8%       3.0      0%
### --risk 1 --streak-budget 2.5 --pause 20
stop · trail 20%                      12.4%   11.0%   13.5%       36.8%   37.3%    0.88         33    -15.3%       1.8      0%
fixed42 · 7% stop                      9.5%    8.1%   11.3%       44.1%   49.4%    0.65         57    -17.8%       3.6      0%
### --risk 1 --streak-budget 2.5 --pause 40
stop · trail 20%                       9.9%    9.5%   10.3%       31.4%   31.9%    0.77         29    -15.9%       2.3      0%
fixed42 · 7% stop                      3.9%    3.6%    4.3%       61.9%   64.7%    0.33         44    -19.9%       5.0      0%
### --risk 1 --streak-budget 4 --pause 20
stop · trail 20%                      13.9%   12.6%   15.2%       30.4%   32.2%    0.97         33    -16.4%       1.9      0%
fixed42 · 7% stop                      9.9%    9.1%   10.6%       36.6%   47.0%    0.67         57    -18.2%       4.5      0%
### --risk 0.5 --streak-budget 2.5 --pause 20
stop · trail 20%                       8.6%    7.2%    9.2%       29.5%   30.5%    0.87         48    -12.4%       1.4      0%
fixed42 · 7% stop                      5.2%    3.8%    6.6%       33.0%   40.7%    0.51         79    -12.0%       1.6      0%
### --risk 1 --streak-budget 2.5 --pause 20 --scale-dd 40
stop · trail 20%                       7.6%    6.0%    9.5%       29.1%   32.4%    0.69         42    -12.7%       2.3      0%
fixed42 · 7% stop                      6.6%    5.0%    8.0%       30.8%   31.4%    0.57         62    -14.6%       2.9      0%
## streak budget with time refill · cost 10bp · 2010+
### --risk 1
stop · trail 20%                      11.6%    9.9%   12.4%       27.2%   28.3%    0.72         46    -12.8%       1.5      0%
fixed42 · 7% stop                     14.5%   13.0%   15.6%       55.2%   59.1%    0.58         84    -13.9%       1.7      0%
### --risk 1 --streak-budget 2.5 --pause 10
stop · trail 20%                       9.1%    7.0%   10.1%       31.5%   33.3%    0.57         42    -15.1%       1.3      0%
fixed42 · 7% stop                      3.2%    1.1%    5.0%       52.6%   63.0%    0.25         69    -26.8%       3.0      0%
### --risk 1 --streak-budget 2.5 --pause 20
stop · trail 20%                      10.0%    7.9%   12.4%       29.0%   30.6%    0.68         36    -15.3%       1.8      0%
fixed42 · 7% stop                      0.7%   -0.6%    3.1%       44.1%   49.4%    0.13         62    -15.1%       2.8      0%
### --risk 1 --streak-budget 2.5 --pause 40
stop · trail 20%                       5.4%    5.0%    5.8%       33.0%   33.4%    0.44         32    -14.8%       1.3      0%
fixed42 · 7% stop                     -2.9%   -3.4%   -2.2%       61.9%   64.7%   -0.11         47    -19.9%       5.0      0%
### --risk 1 --streak-budget 4 --pause 20
stop · trail 20%                      10.2%    7.9%   12.3%       29.7%   32.2%    0.69         36    -16.4%       1.9      0%
fixed42 · 7% stop                      1.3%   -0.6%    2.8%       36.6%   47.0%    0.16         62    -15.0%       3.5      0%
### --risk 0.5 --streak-budget 2.5 --pause 20
stop · trail 20%                       3.9%    2.8%    4.9%       29.5%   30.5%    0.41         52    -12.4%       1.4      0%
fixed42 · 7% stop                      2.7%    1.6%    3.9%       33.0%   40.7%    0.28         85    -12.0%       1.6      0%
### --risk 1 --streak-budget 2.5 --pause 20 --scale-dd 40
stop · trail 20%                       2.6%    1.1%    5.7%       28.7%   32.2%    0.27         53    -13.3%       2.2      0%
fixed42 · 7% stop                      0.6%    0.2%    1.3%       30.8%   31.5%    0.11         61    -14.4%       1.8      0%
```

## Minervini and O'Neil, tested against the same stream

What they publish (sources at the end of this section):

| Claim | Minervini | O'Neil / IBD | Ours (trail 20 %, 7 % stop) |
| --- | --- | --- | --- |
| Batting average | "right around 50 %", "never more than 50 % over 37 years" | — | 32 % (S grade 44 %) |
| Average loss | "about four or five percent" incl. slippage; stops 8–10 % max, staggered | 7–8 % max | 6.9 % |
| Average gain | "12 % gains and 6 % losses" as his working ratio | sell most at 20–25 % | 25.8 % |
| Holding period | winners ~24 days, losers ~20 | 8-week rule for the fastest | 95 bars (trail) / 42 (rotation) |
| Positions | concentrated; pilot buys, quarter/half/full | — | 10 × 14 % |
| Exposure | "25 % invested, or even 50 %… don't step it up until you've got some traction"; 100 % cash in corrections "for months" | raise cash after 5+ distribution days; buy on follow-through days | S&P 200MA switch, flatten below |
| His four pillars | "1. Timing 2. Turnover 3. Aggressive position sizing when trades are working 4. Cash or light positioning [when not]" | | 1 ✓ (200MA) · 2 ✓ (rotation profile) · 4 ✓ (regime exit) · 3 — tested below |

Every mechanical piece of pillar 3 and the rest of his kit was run on the
shipped setup (10 slots, 1 % risk, 200MA switch, RS ≥ 80 strongest-first),
10 bp a side, 12 orderings, 1990–2026:

| Mechanism | Trail 20 % (default) | Fixed 42 (rotation) |
| --- | --- | --- |
| baseline | 12.9 % · 27 % DD | 18.8 % · 55 % DD |
| **Progressive exposure**: ladder 25/50/75/100 % of size, up a rung when the last 5 closed trades net positive, down when negative, floor 25 %, reset to 25 % when the switch turns on | 5.8 % · 20 % DD | 10.4 % · 45 % DD |
| same, 3-trade window | 6.1 % · 19 % | 10.3 % · 51 % |
| same, at 2 % base risk (so full rung = 29 % positions) | 10.7 % · 25 % | 16.4 % · 57 % |
| **Pilot buy 50 %, add the rest at +3 %** | 12.6 % · 28 % | 15.3 % · 44 % |
| pilot 25 %, add at +3 % | 11.6 % · 27 % | 13.7 % · 42 % |
| **Tight 5 % stop** (1 % risk → 20 % positions) | 12.3 % · 38 % DD · 74 % of trades stopped | 10.7 % · 58 % |
| Loose 10 % stop | 13.0 % · 29 % | 15.1 % · 47 % |
| **Universe breakout-health throttle**: size by the mean return of the last 50 *closed* RS ≥ 80 breakouts across the whole market | 7.9 % · 27 % | 11.7 % · 51 % |
| same, sit out entirely when negative | 9.3 % · 34 % | 7.6 % · 62 % |
| Sell half at +20 % (his "sell into strength") — earlier section | 12.9 → 12.7 % | — |
| 200MA switch (his "timing" / "cash") — earlier section | 9.0 → 14.1 % (0 bp) | — |

### Why "size up when it's working" reads as true and tests as false

The claim has a testable core: do recent breakout outcomes predict the next
one? First pass, over every RS ≥ 80 breakout since 1990, ordered by entry
date: the mean return of the previous 5–50 trades correlates **0.20–0.28**
with the next trade's return, and the next trade averages +3 % (fixed 42) /
+7 % (trail) after a positive stretch versus −1.5 to −2.5 % after a negative
one. That is the intuition, and it is real.

Second pass, using only trades that had **already closed** before each entry
(the only information a trader has): correlation **0.00** at every window,
and the next-trade mean is the same whether the prior stretch was positive or
negative (fixed 21: 0.36 % vs 0.46 %; trail: 3.1 % vs 2.5 %, then 2.7 % vs
3.0 %).

The first-pass correlation is trades entered in the same weeks sharing the
same market move — *contemporaneous*, not predictive. By the time a trade
has closed and told you how it went, its information is a month old, and a
month-old read on a momentum regime is worth nothing. That is exactly why
every feedback-based throttle in this study (drawdown halts, streak budgets,
progressive ladders, the universe throttle) subtracts: each one reacts to
realized results, which lag the market, and is scaled up just as the run
ends. The one switch that adds — S&P vs its 200MA — reads the market *now*.

So Minervini's pillar 3 is not mechanical. It is his judgment of the tape
in real time, applied through pilot buys that are judged in days, not the
weeks a closed trade takes. His stated stats (≈50 % hit rate, 4–5 % average
loss, 12 % average gain, 24-day holds) describe a discretionary trader
buying intraday at the pivot with a tight stop — a 5 % stop on our
end-of-day base breakouts stops out 74 % of trades and *raises* the
drawdown. What transfers from him and O'Neil is already in the trader:
the market switch, the clock rotation as a profile, the 7 % stop, no
selling into +20 %.

Sources: [Minervini on X: the four pillars](https://x.com/markminervini/status/1826989022041850163) · [Minervini on X: 25 % exposure, five 5 % positions, 8 % stops → 2 % per round](https://x.com/markminervini/status/1549175636983517185) · [Minervini on X: progressive exposure](https://x.com/markminervini/status/1293567014720745472) · [Minervini on X: applying progressive exposure, pilot buys](https://x.com/markminervini/status/1884705597402059074) · [Minervini on X: batting average arithmetic](https://x.com/markminervini/status/915641533881290752) · [Stockopedia interview: ~50 % batting average, 4–5 % average loss, 8–10 % stops, 25 % → incremental exposure, 100 % cash for months](https://www.stockopedia.com/content/mark-minervini-interview-how-to-trade-like-a-champion-353963/) · [MarketWatch/Sincere interview: 155 % (1997), 334.8 % (2021), 220 % annualized over five years](https://michaelsincere.com/articles/my-marketwatch-interview-with-stock-market-wizard-mark-minervini) · [TraderLion: progressive exposure lesson](https://traderlion.com/lesson/lesson-7-progressive-exposure-the-minervini-method/) · [TraderLion: 2021 championship risk management](https://traderlion.com/investing-champions/mark-minervinis-risk-management/) · [Substack: progressive exposure framework, 5-trade batches](https://tintintrading.substack.com/p/maximizing-profits-with-progressive) · [Business Wire: 2021 USIC results](https://www.businesswire.com/news/home/20220124005241/en/2021-United-States-Investing-Championship-Winners-Minervini-Smashes-Record) · [IBD on X: sell rules 20–25 % / 7–8 %](https://x.com/IBDinvestors/status/1755350824581034256) · [IBD's 20 rules](https://www.pragcap.com/ibds-20-rules/) · [O'Neil's five rules incl. 8-week and follow-through day](https://x.com/BlogJulianKomar/status/1409635231871561729)

```
## Minervini mechanics · cost 10bp · 1990+
### baseline
stop · trail 20%                      12.9%   12.1%   13.3%       27.2%   28.3%    0.85         44    -12.8%       1.5      0%
fixed42 · 7% stop                     18.8%   17.7%   19.9%       55.2%   59.1%    0.80         77    -13.9%       1.7      0%
### --progressive
stop · trail 20%                       5.8%    5.5%    6.3%       19.9%   23.3%    0.73         56    -12.4%       0.9      0%
fixed42 · 7% stop                     10.4%    9.5%   11.5%       44.8%   52.6%    0.63         95    -12.4%       1.3      0%
### --progressive --pe-window 3
stop · trail 20%                       6.1%    5.6%    6.4%       19.4%   20.8%    0.76         56    -12.3%       1.0      0%
fixed42 · 7% stop                     10.3%    9.3%   11.6%       50.6%   53.5%    0.59         95     -9.8%       0.4      0%
### --progressive --pe-window 10
stop · trail 20%                       5.1%    4.9%    5.4%       20.3%   22.6%    0.68         57    -11.8%       1.0      0%
fixed42 · 7% stop                      9.7%    8.8%   10.9%       47.8%   49.5%    0.59         95    -12.8%       1.7      0%
### --pilot 50 --add-at 3
stop · trail 20%                      12.6%   12.0%   13.3%       27.6%   29.1%    0.88         57    -14.1%       2.0      0%
fixed42 · 7% stop                     15.3%   14.4%   16.4%       43.6%   51.3%    0.79         96    -16.4%       1.0      0%
### --pilot 50 --add-at 5 --add-until 15
stop · trail 20%                      12.1%   11.6%   12.7%       27.9%   30.1%    0.84         56    -13.6%       1.0      0%
fixed42 · 7% stop                     15.6%   14.7%   17.0%       44.2%   48.3%    0.80         96    -16.4%       1.0      0%
### --pilot 25 --add-at 3
stop · trail 20%                      11.6%   11.1%   12.1%       27.4%   28.7%    0.81         56    -13.7%       1.8      0%
fixed42 · 7% stop                     13.7%   12.6%   14.8%       41.8%   48.3%    0.78         96    -16.4%       1.1      0%
### --progressive --pilot 50 --add-at 3
stop · trail 20%                       4.4%    4.3%    4.7%       19.1%   21.3%    0.64         57    -11.5%       0.8      0%
fixed42 · 7% stop                      8.5%    7.5%    9.5%       32.4%   36.3%    0.63         96    -12.6%       1.4      0%
### --risk 1.5 --cap 25 --progressive
stop · trail 20%                       5.8%    5.5%    6.3%       19.9%   23.3%    0.73         56    -12.4%       0.9      0%
fixed42 · 7% stop                     10.4%    9.5%   11.5%       44.8%   52.6%    0.63         95    -12.4%       1.3      0%
### --risk 2 --cap 25 --slots 5 --progressive
stop · trail 20%                       5.8%    5.5%    6.3%       19.9%   23.3%    0.73         56    -12.4%       0.9      0%
fixed42 · 7% stop                     10.4%    9.5%   11.5%       44.8%   52.6%    0.63         95    -12.4%       1.3      0%
## Minervini mechanics · cost 10bp · 2010+
### baseline
stop · trail 20%                      11.6%    9.9%   12.4%       27.2%   28.3%    0.72         46    -12.8%       1.5      0%
fixed42 · 7% stop                     14.5%   13.0%   15.6%       55.2%   59.1%    0.58         84    -13.9%       1.7      0%
### --progressive
stop · trail 20%                       4.7%    4.4%    5.5%       19.9%   23.3%    0.53         60    -12.4%       0.9      0%
fixed42 · 7% stop                      8.4%    6.6%    9.5%       44.8%   52.6%    0.45        104    -12.4%       1.3      0%
### --progressive --pe-window 3
stop · trail 20%                       5.0%    4.1%    6.0%       19.4%   20.8%    0.56         60    -12.3%       1.0      0%
fixed42 · 7% stop                      7.9%    6.3%    9.1%       50.6%   53.5%    0.42        104     -9.8%       0.4      0%
### --progressive --pe-window 10
stop · trail 20%                       4.0%    3.2%    4.7%       20.3%   22.6%    0.49         60    -11.8%       1.0      0%
fixed42 · 7% stop                      8.1%    7.0%    9.0%       47.8%   49.5%    0.44        103    -12.8%       1.7      0%
### --pilot 50 --add-at 3
stop · trail 20%                       8.3%    7.2%    9.2%       26.8%   29.1%    0.58         60    -14.1%       1.0      0%
fixed42 · 7% stop                     10.9%    9.6%   12.2%       43.6%   51.3%    0.54        105    -16.4%       1.0      0%
### --pilot 50 --add-at 5 --add-until 15
stop · trail 20%                       8.5%    7.7%    9.1%       27.9%   30.1%    0.59         60    -13.6%       1.0      0%
fixed42 · 7% stop                     10.8%    9.9%   12.0%       44.2%   48.3%    0.53        105    -16.4%       1.0      0%
### --pilot 25 --add-at 3
stop · trail 20%                       7.5%    6.2%    8.4%       27.0%   28.7%    0.53         60    -13.7%       1.0      0%
fixed42 · 7% stop                      8.3%    7.3%    9.2%       41.8%   48.3%    0.48        105    -16.4%       1.0      0%
### --progressive --pilot 50 --add-at 3
stop · trail 20%                       3.1%    2.6%    3.5%       18.9%   21.3%    0.42         60    -11.5%       0.8      0%
fixed42 · 7% stop                      6.4%    4.0%    7.6%       32.4%   36.3%    0.43        105    -12.6%       1.4      0%
### --risk 1.5 --cap 25 --progressive
stop · trail 20%                       4.7%    4.4%    5.5%       19.9%   23.3%    0.53         60    -12.4%       0.9      0%
fixed42 · 7% stop                      8.4%    6.6%    9.5%       44.8%   52.6%    0.45        104    -12.4%       1.3      0%
### --risk 2 --cap 25 --slots 5 --progressive
stop · trail 20%                       4.7%    4.4%    5.5%       19.9%   23.3%    0.53         60    -12.4%       0.9      0%
fixed42 · 7% stop                      8.4%    6.6%    9.5%       44.8%   52.6%    0.45        104    -12.4%       1.3      0%
```

```
## hard stop 0.05 · per-trade
fixed21 · 7% stop        win 45.0% mean 0.46% PF 1.19 bars 15 stopped 44%
fixed42 · 7% stop        win 38.5% mean 0.86% PF 1.28 bars 26 stopped 57%
stop · trail 20%         win 25.4% mean 2.85% PF 1.75 bars 75 stopped 74%
stop · close<MA50        win 33.0% mean 0.96% PF 1.34 bars 31 stopped 42%
## hard stop 0.05 · portfolio · cost 10bp · 1990+ (risk 1%: position = 1%/stop)
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     12.1%   11.4%   12.8%       83.8%   86.7%    0.54        100    -21.3%       5.2      0%
stop · close<MA50                     11.7%    9.7%   14.0%       45.8%   53.8%    0.63         57    -19.7%       5.3      0%
stop · trail 20%                      12.3%   11.1%   13.0%       37.5%   39.4%    0.74         40    -17.6%       3.0      0%
fixed42 · 7% stop                     10.7%    8.6%   12.9%       57.6%   62.1%    0.60         69    -18.8%       3.4      0%
## hard stop 0.05 · portfolio · cost 10bp · 1990+ · progressive
stop · trail 20%                       7.3%    6.4%    8.1%       24.7%   27.1%    0.72         68    -11.9%       1.0      0%
fixed42 · 7% stop                      8.9%    7.5%   10.0%       40.1%   45.2%    0.63        108    -13.6%       2.0      0%
## hard stop 0.05 · portfolio · cost 10bp · 2010+ (risk 1%: position = 1%/stop)
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                      5.0%    3.6%    6.5%       83.8%   86.7%    0.30        112    -21.3%       5.1      0%
stop · close<MA50                      4.2%    1.9%    6.8%       45.8%   53.8%    0.29         64    -19.7%       3.4      0%
stop · trail 20%                      10.4%    9.0%   11.7%       36.8%   38.4%    0.62         43    -17.5%       2.0      0%
fixed42 · 7% stop                      4.4%    1.6%    7.4%       57.6%   62.1%    0.30         76    -18.8%       2.0      0%
## hard stop 0.05 · portfolio · cost 10bp · 2010+ · progressive
stop · trail 20%                       3.7%    2.0%    4.9%       24.7%   27.1%    0.36         77    -11.9%       1.0      0%
fixed42 · 7% stop                      4.1%    1.3%    6.2%       40.1%   45.2%    0.32        120    -13.6%       2.0      0%
## hard stop 0.10 · per-trade
fixed21 · 7% stop        win 53.1% mean 0.60% PF 1.21 bars 19 stopped 19%
fixed42 · 7% stop        win 51.4% mean 1.24% PF 1.33 bars 35 stopped 31%
stop · trail 20%         win 40.3% mean 4.70% PF 1.86 bars 117 stopped 58%
stop · close<MA50        win 37.7% mean 1.22% PF 1.37 bars 36 stopped 12%
## hard stop 0.10 · portfolio · cost 10bp · 1990+ (risk 1%: position = 1%/stop)
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     12.4%   11.6%   13.2%       44.6%   52.7%    0.67        125    -15.2%       1.0      0%
stop · close<MA50                     14.6%   13.7%   15.4%       42.3%   46.1%    0.81         77    -27.2%       4.9      0%
stop · trail 20%                      13.0%   12.3%   13.7%       28.5%   29.8%    0.91         49    -14.3%       1.1      0%
fixed42 · 7% stop                     15.1%   14.3%   16.2%       46.5%   50.0%    0.75         84    -16.1%       1.6      0%
## hard stop 0.10 · portfolio · cost 10bp · 1990+ · progressive
stop · trail 20%                       4.1%    3.5%    4.5%       17.8%   20.3%    0.66         49    -10.9%       0.6      0%
fixed42 · 7% stop                      7.7%    6.8%    8.3%       39.1%   40.6%    0.56         84    -10.1%       0.6      0%
## hard stop 0.10 · portfolio · cost 10bp · 2010+ (risk 1%: position = 1%/stop)
rule                              CAGR mean     min     max  maxDD mean   worst  Sharpe  trades/yr  worst yr  yrs<-10%  halted
fixed21 · 7% stop                     11.1%   10.1%   12.4%       44.6%   52.7%    0.54        137    -15.2%       1.0      0%
stop · close<MA50                      6.9%    4.7%    8.7%       42.3%   46.1%    0.43         86    -27.2%       4.9      0%
stop · trail 20%                      10.4%    9.0%   11.6%       28.5%   29.8%    0.69         52    -14.3%       1.0      0%
fixed42 · 7% stop                     12.7%   11.3%   14.6%       46.5%   50.0%    0.57         90    -16.1%       1.6      0%
## hard stop 0.10 · portfolio · cost 10bp · 2010+ · progressive
stop · trail 20%                       3.7%    2.5%    4.5%       17.8%   20.3%    0.50         52    -10.9%       0.6      0%
fixed42 · 7% stop                      6.9%    6.0%    8.0%       39.1%   40.6%    0.43         90    -10.1%       0.6      0%
```

## Recommendation, revised after the portfolio simulation

- Keep the 7% hard stop. The time backstop is one year, not 90 days.
- **Trail 20% from the peak high on every grade.** This is now the trader's
  default (`TRADE_TRAIL_GRADES=S,A+,A`).
- **In the trader now**: slots filled by `rsRating` strongest-first and a
  SPY-vs-200MA switch that blocks entries and flattens the book below it
  (`TRADE_REGIME_MA`, `TRADE_REGIME_EXIT`, `TRADE_RS_MIN`). Together they
  took the simulated book from 9% to 14% a year and the worst drawdown from
  39% to 26%. The dashboard's health score is a weaker switch: only its
  risk-off line (< 45) is actionable, and "caution" must stay tradable.
- **Do not add equity-curve circuit breakers.** Drawdown halts, equity-MA
  filters and streak pauses all cut the return by two thirds or more and
  remove no bad year the market switch had not already removed. If a softer
  ride is wanted, scale risk with drawdown (`--scale-dd 30`: −2 pts CAGR,
  −5 pts max DD) — a lever, not a default.
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

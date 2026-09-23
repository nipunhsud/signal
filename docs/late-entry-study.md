# The grace day: what a breakout is worth bought one session late

September 2026.

`brokeOutToday` deliberately stays true for one extra session. A 16:00 scan can
see a pre-auction quote under the pivot when the settled close is over it, so
the next scan still fires and the breakout is not lost. That safety net is
real, and it caught breakouts that would otherwise never have emailed.

It had no price ceiling. The entry in a graded email is the base pivot, whatever
price has done since. TWLO on 22 September cleared a $258.35 pivot on the 21st,
closing at $266.06. The following morning the scan saw $279.33, 8.1% past the
pivot, and sent an email with an entry of $258.35 and a fail level of $240.27,
13.6% below the price in the mail. Nobody could take that trade. The breakout
itself was already in the base panel, dated the 21st.

Every other email in the last six weeks went out between 0.4% and 3.3% past its
pivot. TWLO was the outlier, not the pattern.

## Method

The graded pool used by the depth-cut and breakout-bar studies: every base the
detector resolves, 1985 to date, blue-sky pivot, depth at or under 25%, 25 bars
or more, close above a rising 200-day, 100k average volume. 32,700 breakouts
where the session after the breakout bar also closed above the pivot, which is
the only case the grace window can fire in.

Each one is scored twice. Once entered at the breakout close, once at the next
session's close, each with its own 7% fail level and its own 20-bar and 60-bar
windows. Profit factor is gross gains over gross losses with each loss floored
at −7%.

## The extra day is free at the pivot and expensive away from it

| Grace-day close past the pivot | n | PF on the bar | PF a day late | fail touch on the bar | fail touch a day late | mean 20-bar on the bar | mean 20-bar a day late |
|---|---|---|---|---|---|---|---|
| 0 to 2% | 20,409 | 1.88 | 1.82 | 21.5% | 22.2% | 0.87% | 0.78% |
| 2 to 4% | 7,415 | 2.60 | 1.83 | 25.5% | 31.0% | 1.90% | 0.78% |
| 4 to 6% | 2,604 | 3.21 | 1.79 | 28.9% | 37.9% | 2.62% | 0.46% |
| 6 to 8% | 1,037 | 4.25 | 2.10 | 27.5% | 41.5% | 3.93% | 0.88% |
| 8 to 12% | 807 | 5.20 | 2.32 | 29.6% | 45.2% | 5.23% | 1.62% |
| 12%+ | 424 | 5.66 | 2.03 | 30.4% | 51.4% | 6.13% | 0.47% |

Within 2% of the pivot the extra session costs six points of profit factor and
less than a point of fail-level risk. It is free. Past 2% the cost climbs on
every column at once, and by the 8 to 12% band, where TWLO sat, the fail-level
touch rate has risen by 16 points and the average 20-bar return has fallen by
more than two thirds.

Note what the table does not say. A day-late entry is still profitable in every
bucket, 1.79 to 2.32 against a 1.84 baseline. The trade is not bad. It stops
being the trade the email describes, because the entry and the fail level in
that email belong to a price that is no longer on offer.

## The change

The grace window keeps firing, but only while the close is within 2% of the
pivot. The breakout bar itself keeps no ceiling: there the close is the price
on offer, and the breakout-bar study found a decisive clearance is worth more
than a marginal one, not less.

TWLO would not have emailed on the 22nd. It would have emailed on the 21st at
$266.06 if the scan had caught the settled close, which is the case the grace
window exists to cover and is worth 1.88 rather than 2.32.

## Still open

A graded email freezes its entry at the pivot even on the breakout bar, where
the close can sit 12% higher. Deep bases were changed in September to enter at
the close that cleared. The same question applies here and is not answered by
this study.

Script: `scripts/late-entry-study.mjs`.

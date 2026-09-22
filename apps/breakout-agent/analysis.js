// The analysis dossier: everything the screen knows about one stock, with each
// factor weighed against what our own studies measured on it. Pure function of
// gathered inputs — no I/O, no model — so the numbers a reader is given are the
// numbers we validated, and the chat's job is only to narrate them.
//
// The studies behind every figure here, all on the full-history cache:
//   docs/exit-rules-study.md               97,789 graded breakouts (exits)
//   docs/minervini-rules-study.md          44,475 graded breakouts (RS, template)
//   docs/institutional-activity-study.md   44,142 graded breakouts (tape activity)
//   docs/market-health-study.md            44,142 graded breakouts (regime)
// Learn pages carry the readable versions; each factor cites the one that fits.
//
// Two kinds of lever, kept apart on purpose, because the studies say they are
// not interchangeable:
//   hitRate — moves the odds the breakout works at all (grade, blue sky, base
//             age, depth, failed pokes, the market's trend state)
//   payoff  — moves the size of the winner and the fail-level risk with it
//             (relative strength, tape activity, breakout volume)
// A name can be strong on one and ordinary on the other, and saying which is
// most of the value here.

const LEARN = {
  base: 'https://dataquant.ai/learn/reading-a-base-xray',
  rs: 'https://dataquant.ai/learn/relative-strength-explained',
  vcp: 'https://dataquant.ai/learn/volatility-contraction-pattern',
  exits: 'https://dataquant.ai/learn/exit-rules-study',
  health: 'https://dataquant.ai/learn/market-health-gauge',
  distribution: 'https://dataquant.ai/learn/distribution-days-explained',
  backtest: 'https://dataquant.ai/learn/honest-backtest',
};

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const sma = (closes, n) => (closes.length >= n ? closes.slice(-n).reduce((s, v) => s + v, 0) / n : null);

// Price and trend facts from the bars themselves.
export function snapshotOf(bars) {
  if (!bars || bars.length < 60) return null;
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1];
  const win = bars.slice(-252);
  const high52 = Math.max(...win.map((b) => b.high));
  const low52 = Math.min(...win.map((b) => b.low));
  const avgVol20 = bars.slice(-21, -1).reduce((s, b) => s + (b.volume || 0), 0) / 20;
  const ma200 = sma(closes, 200);
  const ma200Prev = closes.length > 221 ? sma(closes.slice(0, -21), 200) : null;
  return {
    asOf: last.time, close: round(last.close), volume: last.volume || 0,
    volumeRatio: avgVol20 > 0 ? round((last.volume || 0) / avgVol20, 2) : null,
    ma20: round(sma(closes, 20)), ma50: round(sma(closes, 50)), ma150: round(sma(closes, 150)), ma200: round(ma200),
    ma200Rising: ma200 != null && ma200Prev != null ? ma200 > ma200Prev : null,
    above200: ma200 != null ? last.close > ma200 : null,
    high52w: round(high52), low52w: round(low52),
    pctFromHigh: round(((high52 - last.close) / high52) * 100, 1),
    pctAboveLow: round((last.close / low52 - 1) * 100, 1),
  };
}

// The grade the screen would give this base, by the same rules the scanner uses.
export function gradeOf(base, snapshot) {
  if (!base || !snapshot || snapshot.above200 !== true) return null;
  if (!base.isBlueSky || base.depthPct > 25) return null;
  if (base.depthPct <= 15 && base.bars >= 80) return 'S';
  if (base.depthPct <= 15 && base.bars >= 25) return 'A+';
  return 'A';
}

const f = (name, value, reading, evidence, lean, learn) => ({ name, value, reading, evidence, lean, learn });

export function buildDossier({ symbol, bars, bases = [], activity = null, signal = null, marketTrend = null, sector = null, episodes = [] }) {
  const snapshot = snapshotOf(bars);
  if (!snapshot) return { symbol, error: 'not enough price history to analyse' };
  const base = bases.length ? bases[bases.length - 1] : null;
  const grade = gradeOf(base, snapshot);
  const weeks = base ? base.weeks : null;
  const depth = base ? base.depthPct : null;
  const pivot = base ? base.pivot : null;
  const pctToPivot = pivot ? round(((pivot - snapshot.close) / snapshot.close) * 100, 1) : null;
  const resolved = base && base.status === 'breakout';
  const rs = signal && signal.rsRating != null ? Number(signal.rsRating) : null;

  const hitRate = [];
  const payoff = [];
  const context = [];

  // ── hit-rate levers ───────────────────────────────────────────────────────
  const deepQualifies = !!(base && base.isBlueSky && depth > 25 && depth <= 35 && base.bars >= 40 && snapshot.above200 === true);
  hitRate.push(deepQualifies && !grade
    ? f('Base kind', 'deep base',
        `${depth}% deep, blue sky, ${weeks} weeks — past the 25% the grade rules allow, inside the deep-base band.`,
        'The 25-35% band the depth cut drops ran a 2.08 profit factor against 1.84 for graded bases, with 24.5% reaching +20% against 13.9%, at a 41% fail-level touch rate against 28%. On 2x breakout volume it ran 2.39 and 28.4%. Bigger winners, more failures.',
        'context', LEARN.base)
    : grade
    ? f('Base grade', grade,
        `The base grades ${grade}.`,
        { S: '62.6% of S breakouts were positive 20 bars on, 11.6% touched the fail level.', 'A+': '57.7% positive, 22.6% touched the fail level.', A: '54.8% positive, 32.1% touched the fail level.' }[grade],
        'supportive', LEARN.base)
    : f('Base grade', 'ungraded',
        base ? `The base does not grade: ${!base.isBlueSky ? 'the pivot is not at the 52-week high' : depth > 25 ? `it is ${depth}% deep` : 'price is under its 200-day'}.` : 'No base detected in the last two years.',
        'Ungraded breakouts were positive 32% of the time against 55-63% for graded ones. This is the largest single difference the studies found.',
        'against', LEARN.base));

  if (base) {
    hitRate.push(f('Blue sky', base.isBlueSky ? 'yes' : 'no',
      base.isBlueSky ? 'The pivot sits at the 52-week high, so a breakout clears every holder from the past year.' : 'The pivot sits below the 52-week high, so there are holders overhead from higher prices.',
      'A blue-sky pivot was positive 57.7% of the time against 34.5% buried, and it held in every decade since the 1970s — the most regime-stable factor measured.',
      base.isBlueSky ? 'supportive' : 'against', LEARN.base));

    hitRate.push(f('Base age', `${weeks} weeks`,
      weeks >= 16 ? 'A long base: supply has had time to clear.' : weeks >= 5 ? 'A medium base.' : 'A short base.',
      weeks >= 16 ? '16-week-plus bases were positive 49.0% of the time against 37.8% for sub-4-week bases, stable in every decade.' : 'Sub-4-week bases were positive 37.8% of the time against 49.0% for 16-week-plus bases.',
      weeks >= 16 ? 'supportive' : weeks >= 5 ? 'neutral' : 'against', LEARN.base));

    const depthLean = depth >= 10 && depth <= 20 ? 'against' : depth < 10 && !base.isBlueSky ? 'against' : 'neutral';
    hitRate.push(f('Depth', `${depth}%`,
      depth >= 10 && depth <= 20 ? 'In the weakest depth pocket the study found.' : depth < 10 ? (base.isBlueSky ? 'Shallow, and at the high — the good version of shallow.' : 'Shallow but buried, the worst combination measured.') : 'Deep: boom or bust.',
      depth >= 10 && depth <= 20 ? '10-20% deep was positive 39.3% of the time, the worst band.' : depth < 10 ? (base.isBlueSky ? 'Shallow at blue sky was positive 56.5%.' : 'Shallow and buried was positive 26.0%.') : 'Bases 20-35% deep are the widest spread of outcomes in the pool.',
      depthLean, LEARN.base));

    hitRate.push(f('Failed pokes', String(base.failedPokes ?? 0),
      (base.failedPokes ?? 0) === 0 ? 'The pivot has not been tested.' : base.failedPokes <= 2 ? 'The pivot was tested and defended.' : 'Sellers have defended the pivot repeatedly.',
      (base.failedPokes ?? 0) === 0 ? 'Untested pivots were positive 40.3% of the time; one or two failed pokes 46.7%.' : base.failedPokes <= 2 ? 'One or two failed pokes were positive 46.7% of the time against 40.3% untested — counter-intuitive but stable.' : 'Three or more pokes means heavy supply overhead.',
      (base.failedPokes ?? 0) === 0 ? 'neutral' : base.failedPokes <= 2 ? 'supportive' : 'against', LEARN.base));
  }

  if (marketTrend) {
    const bad = marketTrend.underBothAverages === true && marketTrend.ma50Rising === false;
    hitRate.push(f('Market trend state', bad ? 'benchmark under both averages, 50-day falling' : marketTrend.label || 'benchmark on or turning up',
      bad ? 'The one tape state that measurably hurt breakouts.' : 'Not a tape state that measurably hurt breakouts.',
      bad ? 'Breakouts taken with the benchmark under both its 50- and 200-day with the 50-day falling ran a 1.27 profit factor and touched the fail level 40% of the time, the only losing state of the six.' : 'Every other trend state ran 1.70 to 2.55; the composite health score itself did not separate outcomes at all (risk-on 1.80, caution 1.80, risk-off 2.00).',
      bad ? 'against' : 'neutral', LEARN.health));
  }

  // ── payoff levers ─────────────────────────────────────────────────────────
  if (rs != null) {
    payoff.push(f('Relative strength', String(rs),
      rs >= 89 ? 'A market leader.' : rs >= 80 ? 'Strong.' : rs >= 70 ? 'Above average.' : 'A laggard by the screen\'s standard.',
      rs >= 95 ? 'RS 95-99 ran a 2.42 profit factor and reached +20% within 60 bars 39.5% of the time, at a 54% fail-level touch rate.'
        : rs >= 89 ? 'RS 89-94 ran 2.20 and reached +20% 26.9% of the time, at a 42% fail-level touch rate.'
        : rs >= 80 ? 'RS 80-88 ran 1.86 and reached +20% 17.5% of the time.'
        : rs >= 70 ? 'RS 70-79 ran 1.68 and reached +20% 12.2% of the time.'
        : 'Under RS 50 the profit factor was 1.75 but only 4.7% ever reached +20%. Every step up in RS lowers the win rate slightly and raises the payoff a lot.',
      rs >= 80 ? 'supportive' : rs >= 70 ? 'neutral' : 'against', LEARN.rs));
  }

  if (activity && activity.score != null) {
    const s = activity.score;
    payoff.push(f('Institutional activity', `${s} of 10`,
      `${activity.acc} heavy up day${activity.acc === 1 ? '' : 's'} and ${activity.dist} heavy down in the last 50 sessions` + (activity.bigUp ? `, ${activity.bigUp} print${activity.bigUp === 1 ? '' : 's'} on double volume at the high` : '') + (activity.udv != null ? `, up volume ${activity.udv}x down inside the base` : '') + '.',
      s >= 7 ? 'Score 7+ ran a 2.41 profit factor and reached +20% 31.8% of the time, at a 42% fail-level touch rate.'
        : s >= 5 ? 'Score 5-6 ran 2.10 and reached +20% 23.8% of the time, at a 36% fail-level touch rate.'
        : s >= 3 ? 'Score 3-4 ran 1.98 and reached +20% 18.7% of the time.'
        : 'Score 0-2 ran 1.75-1.77 and reached +20% 11-13% of the time. Heavy volume in either direction counts: distribution days did not hurt.',
      s >= 5 ? 'supportive' : s >= 3 ? 'neutral' : 'against', LEARN.base));
  }

  const volTag = snapshot.volumeRatio == null ? null : snapshot.volumeRatio >= 2 ? 'power' : snapshot.volumeRatio >= 1.2 ? 'confirmed' : 'quiet';
  if (volTag) {
    payoff.push(f('Volume on the latest bar', `${snapshot.volumeRatio}x the 20-day average`,
      { power: 'Power volume.', confirmed: 'Confirmed volume.', quiet: 'Quiet volume.' }[volTag],
      { power: 'Power-volume breakouts ran a 2.10 profit factor and reached +20% 19.3% of the time, at a 33.5% fail-level touch rate.', confirmed: 'Confirmed volume ran 1.81 and reached +20% 14.0% of the time.', quiet: 'Quiet breakouts ran 1.69 and reached +20% 10.9% of the time, but touched the fail level least often at 24.5% — the safe, small-move corner.' }[volTag],
      volTag === 'power' ? 'supportive' : 'neutral', LEARN.vcp));
  }

  // ── context ───────────────────────────────────────────────────────────────
  if (base) {
    context.push(f('Where price sits', pctToPivot != null && pctToPivot > 0 ? `${pctToPivot}% under the ${pivot} pivot` : pctToPivot != null ? `${Math.abs(pctToPivot)}% above the ${pivot} pivot` : 'no pivot',
      resolved ? `The base resolved on ${base.breakout.date}.` : pctToPivot > 0 ? 'The base has not resolved: no breakout to judge yet.' : 'Price is above the pivot.',
      pctToPivot != null && pctToPivot < -5 ? 'More than 5% past the pivot is an extension of a move already made, not an entry the studies measured.' : 'The measured entry is the first close above the pivot; intrabar pokes through it were traps 81% of the time.',
      'context', LEARN.base));
  }
  if (sector && sector.rank != null && sector.count) {
    const leading = sector.rank <= Math.ceil(sector.count / 3);
    context.push(f('Sector', `${sector.name || 'sector'} ranked ${sector.rank} of ${sector.count}`,
      leading ? 'A leading sector by median relative strength.' : 'Not a leading sector.',
      'Sector rank orders candidates inside an RS band; it has not been measured against outcomes on its own.',
      'context', LEARN.rs));
  }
  if (signal) {
    context.push(f('Screen record', signal.lastAlertAt || signal.alertSentAt ? `emailed ${String(signal.lastAlertAt || signal.alertSentAt).slice(0, 10)}` : 'never emailed',
      signal.lastAlertAt || signal.alertSentAt ? 'The screen emailed this name.' : 'The screen has a record but has never emailed it: an email needs a graded base, a close above the pivot, RS 89+ and confidence 80%+.',
      'Emails are the population every published number counts.',
      'context', LEARN.backtest));
  }
  if (episodes && episodes.length) {
    const past = episodes.filter((e) => e.status && e.status !== 'tracking');
    if (past.length) {
      const won = past.filter((e) => e.status === 'past').length;
      const fell = past.filter((e) => e.status === 'fell').length;
      context.push(f('Earlier breakouts on this name', `${past.length} recorded`,
        `${won} held past the pivot, ${fell} fell through the fail level.`,
        'A name\'s own record is a small sample; the base rates above come from tens of thousands.',
        'context', LEARN.backtest));
    }
  }

  const tally = (arr) => ({
    supportive: arr.filter((x) => x.lean === 'supportive').length,
    against: arr.filter((x) => x.lean === 'against').length,
    neutral: arr.filter((x) => x.lean === 'neutral').length,
  });

  return {
    symbol, asOf: snapshot.asOf, snapshot,
    base: base ? { start: base.start, end: base.end, weeks, depthPct: depth, pivot, low: base.low, status: base.status, isBlueSky: base.isBlueSky, failedPokes: base.failedPokes, coilRatio: base.coilRatio, volumeDryUp: base.volumeDryUp, upDownVolumeRatio: base.upDownVolumeRatio, brokeOut: base.breakout ? base.breakout.date : null, runPct: base.breakout ? base.breakout.runPct : null } : null,
    grade, pctToPivot,
    hitRate, payoff, context,
    weight: { hitRate: tally(hitRate), payoff: tally(payoff) },
    exits: {
      failLevel: pivot ? round(pivot * 0.93) : null,
      rule: 'The measured pair is a 7% fail level under the pivot and a 20% trailing stop from the peak, with the position let go when the benchmark closes under its 200-day.',
      evidence: 'Over 97,789 graded breakouts the 20% trail beat every tighter exit; in the portfolio simulation RS-ranked slot filling with that trail and the 200-day switch grew at 14% a year with a 26% maximum drawdown. Median hold is around 95 bars, so this is a months-long rule, not a weekly one.',
      learn: LEARN.exits,
    },
    notCredited: [
      { factor: 'Distribution days', finding: 'Nine or more in 25 sessions went with a 2.14 profit factor against 1.28 for none. It does not warn of worse breakouts.', learn: LEARN.distribution },
      { factor: 'Market health score', finding: 'The composite did not separate outcomes: risk-on 1.80, caution 1.80, risk-off 2.00.', learn: LEARN.health },
      { factor: 'Breadth', finding: 'Flat from under 40% of the market up on the month to over 70%.', learn: LEARN.health },
      { factor: 'Tightness into the pivot', finding: 'A 10-bar range under 3% won more often (59.9%) but only 2.6% ever reached +20%. It is a low-risk label, not a return label.', learn: LEARN.vcp },
      { factor: 'Gaps and close position', finding: 'Neither justified a rule; a 2-10% gap was the best bucket but not by enough to gate on.', learn: LEARN.vcp },
    ],
    howToRead: 'Hit-rate factors move the odds the breakout works; payoff factors move the size of the winner and the fail-level risk with it. A name strong on payoff and ordinary on hit rate is a bigger-winner, bigger-fail profile, which is what the 20% trail is for. Nothing here is a recommendation.',
    disclaimer: 'Screen output for research, not advice.',
  };
}

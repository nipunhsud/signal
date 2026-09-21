// Institutional activity from the tape — the footprints big buyers leave in
// price and volume before a breakout, scored 0–10. Validated on 44,142 graded
// breakouts 1985–2026 (docs/institutional-activity-study.md): score 0 → 7+
// lifts the profit factor 1.77 → 2.41 and reach-+20% 10.6% → 31.8%, with the
// win rate flat and the fail-level touch rate up. A size-of-winner lever, so
// it ranks; it never gates a breakout on its own. Pure function, tested.
//
//   bars: ascending daily bars {open, high, low, close, volume}, today last
//   base: the current base-detect segment (for up/down volume and OBV), or null
const WINDOW = 50;

export function computeActivity(bars, base) {
  const n = bars.length;
  const i = n - 1;
  if (n < WINDOW + 52) return null; // need the window plus a trailing 50-day average and a 52w high
  const hi = (k) => bars[k].high;
  let acc = 0, dist = 0, bigUp = 0;
  // 52-week high as of each bar's prior session, rolled forward.
  let h252 = 0;
  for (let k = Math.max(0, i - WINDOW - 251); k < i - WINDOW; k++) h252 = Math.max(h252, hi(k));
  // trailing 50-day average volume BEFORE bar k, as a running sum
  let volSum = 0;
  for (let k = i - WINDOW - 50; k < i - WINDOW; k++) volSum += bars[k].volume || 0;
  for (let k = i - WINDOW + 1; k <= i; k++) {
    h252 = Math.max(h252, hi(k - 1));
    volSum += (bars[k - 1].volume || 0) - (bars[k - 51].volume || 0);
    const av = volSum / 50;
    const ret = bars[k].close / bars[k - 1].close - 1;
    const v = bars[k].volume || 0;
    if (av > 0 && v >= av * 1.5 && ret >= 0.01) acc++;
    if (av > 0 && v >= av * 1.5 && ret <= -0.01) dist++;
    if (av > 0 && ret >= 0.02 && v >= av * 2 && bars[k].close >= h252 * 0.95) bigUp++;
  }
  const udv = base && Number.isFinite(base.upDownVolumeRatio) ? base.upDownVolumeRatio : null;
  // OBV drift across the base as a share of its volume (-1..1).
  let obv = null;
  if (base && base.start && base.end) {
    let s = 0, tot = 0, inBase = false;
    for (let k = 1; k <= i; k++) {
      const t = bars[k].time;
      if (t === base.start) inBase = true;
      if (!inBase) continue;
      if (t > base.end) break;
      const v = bars[k].volume || 0; tot += v;
      if (bars[k].close > bars[k - 1].close) s += v; else if (bars[k].close < bars[k - 1].close) s -= v;
    }
    obv = tot ? s / tot : 0;
  }
  const net = acc - dist;
  const points = {
    net: net >= 5 ? 3 : net >= 3 ? 2 : net >= 1 ? 1 : 0,
    bigUp: bigUp >= 3 ? 3 : bigUp >= 2 ? 2 : bigUp >= 1 ? 1 : 0,
    udv: udv == null ? 0 : udv >= 2 ? 2 : udv >= 1.5 ? 1 : 0,
    obv: obv == null ? 0 : obv >= 0.2 ? 2 : obv >= 0.05 ? 1 : 0,
  };
  const score = points.net + points.bigUp + points.udv + points.obv;
  return {
    score, acc, dist, bigUp,
    udv: udv == null ? null : Math.round(udv * 100) / 100,
    obv: obv == null ? null : Math.round(obv * 1000) / 1000,
    points,
  };
}

// The study's odds for a score, for labels and the alert email.
export function activityOdds(score) {
  if (score == null) return null;
  if (score >= 7) return { pf: 2.41, reach20: 32, stop: 42 };
  if (score >= 5) return { pf: 2.10, reach20: 24, stop: 36 };
  if (score >= 3) return { pf: 1.98, reach20: 19, stop: 33 };
  if (score >= 1) return { pf: 1.75, reach20: 13, stop: 27 };
  return { pf: 1.77, reach20: 11, stop: 25 };
}

// One sentence in the product voice: what the tape showed, then the odds.
export function activityWords(a) {
  if (!a) return '';
  const days = `${a.acc} heavy up day${a.acc === 1 ? '' : 's'} and ${a.dist} heavy down day${a.dist === 1 ? '' : 's'} in the last 50 sessions`;
  const prints = a.bigUp ? `, ${a.bigUp} print${a.bigUp === 1 ? '' : 's'} on double volume at the high` : '';
  const udv = a.udv != null && a.udv >= 1.5 ? `, up volume ${a.udv}x down volume in the base` : '';
  const o = activityOdds(a.score);
  return `${days}${prints}${udv}. Breakouts with this score reached +20% ${o.reach20}% of the time historically, profit factor ${o.pf.toFixed(2)}.`;
}

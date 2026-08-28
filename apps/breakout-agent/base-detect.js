// Base segmentation: turn a daily bar series into discrete base objects —
// consolidation episodes beneath a pivot, each with its own lifecycle and
// quality metrics. Pure function of the bars; no I/O. Used by /api/bases.
//
// Algorithm: walk the series; each swing high H opens a candidate base. The
// base spans every following bar that stays at/below H (0.2% poke tolerance —
// an intrabar wick above H that closes back under doesn't end the base, it
// counts as a failed poke). A candidate becomes a base at >= MIN_BARS bars and
// dies if it gets deeper than MAX_DEPTH. It ends when a bar CLOSES above H
// (status "breakout") or the series ends (status "forming"). A base whose low
// undercuts depth limit mid-formation is discarded — that's a downtrend, not
// a base. Bases are sequential (no nesting) — v1 keeps the timeline simple.

const MIN_BARS = 10; // ~2 weeks
const MAX_DEPTH = 0.35; // O'Neil: >35% deep is broken structure, not a base
// Wicks over the pivot don't end the base — they're the failed pokes. Only a
// CLOSE above the pivot, or an intrabar move >2% through it, counts as the
// breakout that resolves the base. Keeps "forming" possible only at the right
// edge of the series.
const INTRABAR_BREAKOUT = 1.02;

export function detectBases(bars) {
  const n = bars.length;
  const bases = [];
  let i = 0;
  while (i < n - 1) {
    const pivot = bars[i].high;
    let j = i + 1;
    let ended = null; // index of the bar that closed above pivot
    while (j < n) {
      if (bars[j].close > pivot || bars[j].high > pivot * INTRABAR_BREAKOUT) {
        ended = j;
        break;
      }
      j++;
    }
    const span = j - (i + 1); // bars inside the base (pivot bar excluded)
    if (span >= MIN_BARS) {
      const inside = bars.slice(i + 1, j);
      const low = Math.min(...inside.map((b) => b.low));
      const depth = (pivot - low) / pivot;
      if (depth <= MAX_DEPTH) {
        bases.push(buildBase(bars, i, j, ended, pivot, low, depth));
        i = ended != null ? ended : j; // continue after the base resolves
        continue;
      }
    }
    i++;
  }
  return bases;
}

function buildBase(bars, pivotIdx, endIdx, endedIdx, pivot, low, depth) {
  const inside = bars.slice(pivotIdx + 1, endIdx);
  const n = inside.length;

  // Volume dry-up: base average vs the 50 bars before the base (or what exists)
  const beforeStart = Math.max(0, pivotIdx - 50);
  const before = bars.slice(beforeStart, pivotIdx + 1);
  const avg = (arr, f) => (arr.length ? arr.reduce((s, b) => s + f(b), 0) / arr.length : 0);
  const beforeVol = avg(before, (b) => b.volume || 0);
  const baseVol = avg(inside, (b) => b.volume || 0);
  const volumeDryUp = beforeVol > 0 ? baseVol / beforeVol : 0;

  // Up/down volume inside the base (close vs prior close)
  let upVol = 0;
  let downVol = 0;
  for (let k = pivotIdx + 1; k < endIdx; k++) {
    if (bars[k].close > bars[k - 1].close) upVol += bars[k].volume || 0;
    else if (bars[k].close < bars[k - 1].close) downVol += bars[k].volume || 0;
  }
  const upDownVolumeRatio = downVol > 0 ? upVol / downVol : upVol > 0 ? 99 : 0;

  // Failed pokes at this base's pivot
  const failedPokes = inside.filter(
    (b) => b.high >= pivot * 0.995 && b.close <= pivot * 0.99,
  ).length;

  // Coil: 2nd-half range / 1st-half range
  const range = (arr) =>
    arr.length ? Math.max(...arr.map((b) => b.high)) - Math.min(...arr.map((b) => b.low)) : 0;
  const firstHalf = range(inside.slice(0, Math.floor(n / 2)));
  const secondHalf = range(inside.slice(Math.floor(n / 2)));
  const coilRatio = firstHalf > 0 ? secondHalf / firstHalf : 0;

  // The "road": progressive contraction in thirds — Minervini's staircase.
  // r1 >= r2 >= r3 (3% slack) with >=10% net shrink. Alone it predicts
  // nothing (45.1% vs 44.2%), but INSIDE the coil+volume gate it separates
  // 59.6%-win bases from 50.7% — real absorption vs lucky shape.
  const t3 = Math.floor(n / 3);
  const r1 = range(inside.slice(0, t3));
  const r2 = range(inside.slice(t3, 2 * t3));
  const r3 = range(inside.slice(2 * t3));
  const isStaircase = t3 >= 3 && r1 > 0 && r2 <= r1 * 1.03 && r3 <= r2 * 1.03 && r3 < r1 * 0.9;

  // Blue sky: the pivot is (within 2% of) the highest price seen so far
  const priorHigh = Math.max(...bars.slice(0, pivotIdx + 1).map((b) => b.high));
  const isBlueSky = pivot >= priorHigh * 0.98;

  // Breakout outcome, when there is one: volume ratio on the breakout bar and
  // the maximum run since (for "broke out — ran +X%" storytelling)
  let breakout = null;
  if (endedIdx != null) {
    const bo = bars[endedIdx];
    const boVolRatio = baseVol > 0 ? (bo.volume || 0) / baseVol : 0;
    const after = bars.slice(endedIdx);
    const maxCloseAfter = Math.max(...after.map((b) => b.close));
    breakout = {
      date: bars[endedIdx].time,
      volumeRatio: round(boVolRatio, 2),
      runPct: round(((maxCloseAfter - pivot) / pivot) * 100, 1),
    };
  }

  return {
    start: inside[0].time,
    end: inside[n - 1].time,
    pivotDate: bars[pivotIdx].time,
    pivot: round(pivot, 2),
    low: round(low, 2),
    depthPct: round(depth * 100, 1),
    bars: n,
    weeks: round(n / 5, 1),
    status: endedIdx != null ? "breakout" : "forming",
    breakout,
    volumeDryUp: round(volumeDryUp, 2),
    upDownVolumeRatio: round(upDownVolumeRatio, 2),
    failedPokes,
    coilRatio: round(coilRatio, 2),
    isStaircase,
    isBlueSky,
    // VCP-ish: tightening into the pivot on drying volume
    isVcpShape: coilRatio > 0 && coilRatio < 0.8 && volumeDryUp > 0 && volumeDryUp < 0.9,
  };
}

function round(v, d) {
  const m = Math.pow(10, d);
  return Math.round(v * m) / m;
}

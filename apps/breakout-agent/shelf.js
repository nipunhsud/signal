// Where a shelf breakout sits inside its base — Minervini's cheat areas.
//
// The screen's Type 1 trigger is a close above the 20-bar high. When that
// high sits INSIDE a base the detector still calls forming (price under the
// base pivot), the entry is a shelf inside the base, not the base pivot:
//   lower third of the base  → low cheat
//   middle third             → cheat
//   upper third              → handle (a shelf just under the pivot)
// SWKS 2026-09-02: base pivot 84.79, 34.6% deep (low ~55.45), shelf high
// 70.75 → 52% up the base → cheat. Never emailed (the base did not grade and
// the pivot was not cleared); this label says what it was.
// Pure function, tested in test/shelf.test.mjs.
export function classifyShelf({ level, basePivot, baseDepthPct, price }) {
  const pivot = Number(basePivot);
  const depth = Number(baseDepthPct);
  const lvl = Number(level);
  const px = Number(price);
  if (!(pivot > 0) || !(depth > 0) || !(lvl > 0) || !(px > 0)) return null;
  if (px >= pivot * 0.999) return null; // the base resolved — that is a pivot breakout, not a shelf
  const baseLow = pivot * (1 - depth / 100);
  const span = pivot - baseLow;
  if (!(span > 0)) return null;
  const pos = (lvl - baseLow) / span;
  if (pos < -0.02 || pos > 1.0) return null; // the level is not inside this base
  const p = Math.min(1, Math.max(0, pos));
  const kind = p < 1 / 3 ? 'low-cheat' : p < 2 / 3 ? 'cheat' : 'handle';
  const label = { 'low-cheat': 'Low cheat', cheat: 'Cheat', handle: 'Handle' }[kind];
  return {
    kind,
    label,
    posPct: Math.round(p * 100),
    baseLow: Math.round(baseLow * 100) / 100,
    basePivot: Math.round(pivot * 100) / 100,
    level: Math.round(lvl * 100) / 100,
    pctBelowPivot: Math.round(((pivot - px) / pivot) * 1000) / 10,
  };
}

// The cheat alert gate (Sep 2026). A shelf breakout earns an email when:
//   the base would grade if it resolved (blue sky, <=25% deep, above the
//   200-day: baseGrade is set), it has NOT resolved today, the close cleared
//   the 20-bar high after a tight 5-bar shelf, on volume, with a bullish bar,
//   and the stock is liquid. Returns the shelf classification or null.
// SWKS 2026-09-02 fails this gate: its base was 34.6% deep, so it carried no
// grade. A 22%-deep blue-sky base with the same bars would have emailed.
export function cheatGate(a) {
  if (!a || a.isGradedBreakout) return null; // the pivot close already alerts
  if (!a.baseGrade || a.gradedBreakoutToday) return null;
  if (!a.liquidityOk || !a.volumeOk || !a.bullishCandle || !a.cleanConsolidation) return null;
  if (!(Number(a.close) > Number(a.resistance))) return null;
  return classifyShelf({ level: a.resistance, basePivot: a.basePivot, baseDepthPct: a.baseDepthPct, price: a.close });
}

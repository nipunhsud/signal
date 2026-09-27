// A line the reader drew, and whether today's close crossed it.
//
// The line is two anchors in (time, price). Its value at any later moment is
// the straight continuation through them, so a downward trendline drawn across
// two highs keeps falling and price can rise through it.
//
// Pure arithmetic, no dates library and no database, so it is testable on its
// own. Tested in test/chart-lines.test.mjs.

// Price of the line at time t (seconds). Null for a vertical line, which has
// no value to compare a close against.
export function lineValueAt(line, t) {
  const { t1, p1, t2, p2 } = line || {};
  if (![t1, p1, t2, p2, t].every((v) => Number.isFinite(v))) return null;
  if (t2 === t1) return null;
  return p1 + ((p2 - p1) * (t - t1)) / (t2 - t1);
}

// A segment stops at its second anchor; a ray and a horizontal carry on.
export function isLive(line, t) {
  if (!line) return false;
  if (line.kind === 'segment') return t <= Math.max(line.t1, line.t2);
  return true;
}

const sideOf = (close, value) => (close > value ? 'above' : close < value ? 'below' : null);

// Did this close cross the line since we last looked?
//
// A crossing is a change of side, not a standing condition — otherwise a stock
// that closed above the line in March would email every session since. The
// first check only records which side it is on and says nothing, because we
// have no idea whether it just got there.
export function crossing(line, close, t) {
  if (!line || !Number.isFinite(close)) return null;
  if (!isLive(line, t)) return null;
  const value = lineValueAt(line, t);
  if (value == null) return null;
  const side = sideOf(close, value);
  if (!side) return null;                       // sitting exactly on it
  if (!line.lastSide) return { side, value, first: true };
  if (line.lastSide === side) return { side, value, crossed: false };
  return { side, value, crossed: true, from: line.lastSide };
}

export function crossingWords(asset, line, cross) {
  if (!cross || !cross.crossed) return null;
  const level = cross.value >= 100 ? cross.value.toFixed(0) : cross.value.toFixed(2);
  const drawn = line.kind === 'horizontal' ? 'the level you drew' : 'the line you drew';
  return `${asset} closed ${cross.side} ${drawn}, now at $${level}.`;
}

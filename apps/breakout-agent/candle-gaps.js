// Filling a session Yahoo left null.
//
// Yahoo's chart API publishes a timestamp for every session but sometimes
// returns null OHLC for one. On 2026-09-22 it did that for every US symbol,
// SPY and QQQ included, and the fetcher drops a null bar as a gap. The whole
// session then disappeared from the chart, the base boxes, the analysis and
// the chat, because all four read the same candle getter. The agents' bar
// store holds the settled FMP bar for exactly those sessions.
//
// Only sessions inside the range Yahoo returned are filled, so the 2-year
// window and the chart's range control stay where they were. Yahoo wins any
// date both sources have: it carries today's live bar, and the store holds
// only closed sessions.
export function mergeGapBars(bars, store) {
  if (!Array.isArray(bars) || !bars.length) return bars || [];
  if (!Array.isArray(store) || !store.length) return bars;
  const have = new Set(bars.map((b) => b.time));
  const first = bars[0].time;
  const last = bars[bars.length - 1].time;
  const fill = store.filter(
    (b) => b && b.time && b.time >= first && b.time <= last && !have.has(b.time),
  );
  if (!fill.length) return bars;
  return [...bars, ...fill].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

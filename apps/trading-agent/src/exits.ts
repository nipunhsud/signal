// Sell-rule math, pure and unit-tested. Rules come from docs/exit-rules-study.md
// (97,789 graded breakouts): a close below the 50-day MA is the best single
// sell rule; a 20% trail from the peak is worth it on S-grade names only.

export function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

/** True when the latest close sits below the n-day SMA (computed including that close). */
export function closedBelowMa(closes: number[], n: number): boolean {
  const ma = sma(closes, n);
  return ma != null && closes[closes.length - 1] < ma;
}

/**
 * Trailing stop from the highest high since entry. Never below the current
 * stop, and only reported as a move when it clears the old stop by `minStepPct`
 * (avoids a broker replace every few cents).
 */
export function trailingStop(p: {
  peakHigh: number;
  trailPct: number;
  currentStop: number;
  minStepPct?: number;
}): number | null {
  const candidate = p.peakHigh * (1 - p.trailPct / 100);
  const step = p.minStepPct ?? 0.5;
  if (candidate <= p.currentStop * (1 + step / 100)) return null;
  return Math.round(candidate * 100) / 100;
}

/** New York calendar date of a timestamp, YYYY-MM-DD. */
export function nyDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(d);
}

/** True after the NYSE close (16:05 ET) on a weekday — when the daily review may run. */
export function afterClose(d: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10);
  return mins >= 16 * 60 + 5;
}

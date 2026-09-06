// Which of a cycle's candidates get the free slots. Pure, unit-tested.
// Study result (docs/exit-rules-study.md): taking the same signals
// strongest-first lifted the simulated book from 9% to 14% a year at the same
// drawdown; a relative-strength floor on its own did little.

const GRADE_RANK: Record<string, number> = { S: 0, "A+": 1, A: 2 };

export interface Candidate {
  asset: string;
  rsRating: number | null;
  baseGrade: string | null;
  alertSentAt: Date | null;
}

/** Strongest relative strength first; grade breaks ties; then oldest alert. Unknown RS sorts last. */
export function rankCandidates<T extends Candidate>(cands: T[]): T[] {
  return [...cands].sort(
    (a, b) =>
      (b.rsRating ?? -1) - (a.rsRating ?? -1) ||
      (GRADE_RANK[a.baseGrade ?? ""] ?? 9) -
        (GRADE_RANK[b.baseGrade ?? ""] ?? 9) ||
      (a.alertSentAt?.getTime() ?? 0) - (b.alertSentAt?.getTime() ?? 0),
  );
}

/** True when the candidate clears the RS floor (a missing rating never clears a floor above 0). */
export function passesRsFloor(rsRating: number | null, rsMin: number): boolean {
  if (rsMin <= 0) return true;
  return rsRating != null && rsRating >= rsMin;
}

export interface Regime {
  date: string;
  symbol: string;
  close: number;
  ma: number;
  above: boolean;
}

/** Market switch: latest close vs its n-day SMA. Null when there is not enough history. */
export function regimeFrom(
  symbol: string,
  date: string,
  closes: number[],
  n: number,
): Regime | null {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  const ma = s / n;
  const close = closes[closes.length - 1];
  return { date, symbol, close, ma, above: close > ma };
}

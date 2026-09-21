export interface Activity {
  score: number; acc: number; dist: number; bigUp: number;
  udv: number | null; obv: number | null;
  points: { net: number; bigUp: number; udv: number; obv: number };
}
export function computeActivity(
  bars: { time?: string; open: number; high: number; low: number; close: number; volume: number }[],
  base: { start?: string; end?: string; upDownVolumeRatio?: number } | null | undefined,
): Activity | null;
export function activityOdds(score: number | null | undefined): { pf: number; reach20: number; stop: number } | null;
export function activityWords(a: Activity | null | undefined): string;

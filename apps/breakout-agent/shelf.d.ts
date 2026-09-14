// Types for shelf.js (see that file for the rules).
export interface Shelf {
  kind: 'low-cheat' | 'cheat' | 'handle';
  label: 'Low cheat' | 'Cheat' | 'Handle';
  posPct: number;
  baseLow: number;
  basePivot: number;
  level: number;
  pctBelowPivot: number;
}
export function classifyShelf(a: {
  level: number | null | undefined;
  basePivot: number | null | undefined;
  baseDepthPct: number | null | undefined;
  price: number | null | undefined;
}): Shelf | null;
export function cheatGate(a: {
  isGradedBreakout: boolean;
  baseGrade: string | null;
  gradedBreakoutToday: boolean;
  liquidityOk: boolean;
  volumeOk: boolean;
  bullishCandle: boolean;
  cleanConsolidation: boolean;
  close: number;
  resistance: number;
  basePivot: number | null | undefined;
  baseDepthPct: number | null | undefined;
}): Shelf | null;

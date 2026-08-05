import type { MarketData } from "./market-data.js";

// MissionWinners-style screen. Two thresholds from the source data:
//   30% quarter-prior EPS/rev growth = qualifying tier
//   50% = elite tier (71% and 63% of historical winners hit this)
// Tier grid:
//   A — both EPS and revenue ≥ 50%
//   B — one metric ≥ 50%, both ≥ 30%
//   C — both ≥ 30% (baseline qualifier)
// Sub-30% on either → no signal.

export type WinnerTier = "A" | "B" | "C";

export interface WinnerSetupResult {
  qualifies: boolean;
  tier?: WinnerTier;
  confidence: number; // 0..1
  reason: string;
  // Snapshotted fields for persistence
  currentPrice: number;
  high52w?: number;
  distFrom52wHighPct?: number;
  ma50?: number;
  ma200?: number;
  maStacked: boolean;
  epsGrowthPct?: number;
  revenueGrowthPct?: number;
}

const MIN_GROWTH = 30;
const ELITE_GROWTH = 50;
// Technical setup: name has to be in the top of its range, not broken down.
const MAX_DIST_FROM_52W_HIGH_PCT = 15;

function classifyTier(eps: number, rev: number): WinnerTier | null {
  if (eps < MIN_GROWTH || rev < MIN_GROWTH) return null;
  if (eps >= ELITE_GROWTH && rev >= ELITE_GROWTH) return "A";
  if (eps >= ELITE_GROWTH || rev >= ELITE_GROWTH) return "B";
  return "C";
}

function tierConfidence(tier: WinnerTier, maStacked: boolean, distFrom52w: number): number {
  // Base confidence maps to the historical hit-rates from MissionWinners:
  //   A — 63-71% zone → 0.80
  //   B — mixed → 0.72
  //   C — 86-87% qualifying zone but lowest edge → 0.65
  const base = tier === "A" ? 0.80 : tier === "B" ? 0.72 : 0.65;
  let c = base;
  if (maStacked) c += 0.05;
  // Closer to 52w high = tighter setup
  if (distFrom52w <= 5) c += 0.05;
  else if (distFrom52w <= 10) c += 0.02;
  return Math.max(0.5, Math.min(0.95, c));
}

// Moving Winners: same fundamentals filter as setup, but the stock is already
// in a measurable move over one or more trailing windows. MissionWinners-faithful
// interpretation — the fundamentals identify winners; the moves show where they
// currently are on the timeframe curve.
export type MovingWindow = "1w" | "1m" | "3m";

export interface MovingWinnerResult {
  window: MovingWindow;
  tier: WinnerTier;
  confidence: number;
  reason: string;
  currentPrice: number;
  returnPct: number;
  high52w?: number;
  distFrom52wHighPct?: number;
  ma50?: number;
  ma200?: number;
  maStacked: boolean;
  epsGrowthPct?: number;
  revenueGrowthPct?: number;
}

// Minimum trailing return to qualify as "moving" per window.
// ponytail: hand-tuned thresholds, revisit if lists come back empty or noisy.
const MOVING_THRESHOLDS: Record<MovingWindow, number> = {
  "1w": 5,
  "1m": 15,
  "3m": 30,
};

export function screenMovingWinners(data: MarketData): MovingWinnerResult[] {
  if (data.assetType !== "stock") return [];
  const eps = data.epsGrowthPct;
  const rev = data.revenueGrowthPct;
  if (eps == null || rev == null) return [];
  const tier = classifyTier(eps, rev);
  if (!tier) return [];

  const maStacked = data.close > data.ma50 && data.ma50 > data.ma200;
  const high52w = data.high52w;
  const distFrom52w =
    high52w && high52w > 0 ? ((high52w - data.close) / high52w) * 100 : undefined;

  const windows: Array<[MovingWindow, number | undefined]> = [
    ["1w", data.return1wPct],
    ["1m", data.return1mPct],
    ["3m", data.return3mPct],
  ];

  const base = tier === "A" ? 0.80 : tier === "B" ? 0.72 : 0.65;
  const results: MovingWinnerResult[] = [];
  for (const [window, ret] of windows) {
    if (ret == null) continue;
    const threshold = MOVING_THRESHOLDS[window];
    if (ret < threshold) continue;

    // Return-magnitude boost: capped so a monster run doesn't push above 0.95.
    const boost = Math.min(0.15, ((ret - threshold) / (threshold * 3)) * 0.15);
    const confidence = Math.max(0.5, Math.min(0.95, base + boost));

    results.push({
      window,
      tier,
      confidence,
      reason: `Tier ${tier}: +${ret.toFixed(1)}% over ${window}, EPS ${eps.toFixed(0)}%, Rev ${rev.toFixed(0)}%`,
      currentPrice: data.close,
      returnPct: ret,
      high52w,
      distFrom52wHighPct: distFrom52w,
      ma50: data.ma50,
      ma200: data.ma200,
      maStacked,
      epsGrowthPct: eps,
      revenueGrowthPct: rev,
    });
  }
  return results;
}

export function screenSetupWinner(data: MarketData): WinnerSetupResult {
  const noQualify = (reason: string, extras: Partial<WinnerSetupResult> = {}): WinnerSetupResult => ({
    qualifies: false,
    confidence: 0,
    reason,
    currentPrice: data.close,
    high52w: data.high52w,
    ma50: data.ma50,
    ma200: data.ma200,
    maStacked: false,
    epsGrowthPct: data.epsGrowthPct,
    revenueGrowthPct: data.revenueGrowthPct,
    ...extras,
  });

  // Stocks only — ETFs don't have per-issue earnings/revenue.
  if (data.assetType !== "stock") return noQualify("not a stock");

  const eps = data.epsGrowthPct;
  const rev = data.revenueGrowthPct;
  if (eps == null || rev == null) return noQualify("missing fundamentals");

  const tier = classifyTier(eps, rev);
  if (!tier) return noQualify(`growth below ${MIN_GROWTH}% threshold`);

  // Technical setup gate: near 52w high AND stacked MAs (close > MA50 > MA200).
  const high52w = data.high52w;
  const distFrom52w =
    high52w && high52w > 0 ? ((high52w - data.close) / high52w) * 100 : Infinity;
  const maStacked = data.close > data.ma50 && data.ma50 > data.ma200;

  if (distFrom52w > MAX_DIST_FROM_52W_HIGH_PCT) {
    return noQualify(
      `${distFrom52w.toFixed(1)}% below 52w high (max ${MAX_DIST_FROM_52W_HIGH_PCT}%)`,
      { distFrom52wHighPct: distFrom52w, maStacked },
    );
  }
  if (!maStacked) {
    return noQualify("MAs not stacked (need close > MA50 > MA200)", {
      distFrom52wHighPct: distFrom52w,
      maStacked,
    });
  }

  const confidence = tierConfidence(tier, maStacked, distFrom52w);

  return {
    qualifies: true,
    tier,
    confidence,
    reason: `Tier ${tier}: EPS ${eps.toFixed(0)}%, Rev ${rev.toFixed(0)}%, ${distFrom52w.toFixed(1)}% off 52w high`,
    currentPrice: data.close,
    high52w,
    distFrom52wHighPct: distFrom52w,
    ma50: data.ma50,
    ma200: data.ma200,
    maStacked,
    epsGrowthPct: eps,
    revenueGrowthPct: rev,
  };
}

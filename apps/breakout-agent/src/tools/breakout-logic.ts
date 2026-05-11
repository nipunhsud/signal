import { MarketData } from "./market-data";

export interface BreakoutAnalysis {
  resistance: number;
  support: number;
  ma20: number;
  ma50: number;
  ma150: number;
  ma200: number;
  maStack: boolean; // 200 < 150 < 50 < 20 (proper uptrend)
  maStackTurning: boolean; // 20MA and 50MA turning up
  barsInRange: number;
  volumeOk: boolean;
  breakoutSignal: boolean;
  bullishCandle: boolean; // close > open on breakout bar
  consolidationOk: boolean; // barsInRange >= minStructureBars
  pineScriptGreen: boolean; // Full Pine Script signal (green cone)
  confidence: number;
  high52w: number;
  earningsGrowth: number;
  // Fundamentals
  epsGrowthPct: number;
  revenueGrowthPct: number;
  epsBeat: boolean;
  epsSurprisePct: number;
  sector: string;
  industry: string;
  beta: number;
  fedFundsRate: number;
  // Type 1 (fresh breakout from real base) vs Type 3 (continuation)
  breakoutType: "Type1" | "Type3" | "unknown";
  priorBaseDays: number;
  priorBaseRangePercent: number;
  priorBreakoutBarsAgo: number;
  liquidityOk: boolean;
}

export interface SetupAnalysis {
  isSetup: boolean; // Consolidation + bullish MAs + low volume (pre-breakout)
  setupType: "none" | "base" | "handle";
  distanceFromMA20: number; // % distance from 20 MA
  distancePenalty: number; // Confidence penalty for distance from MA20
  confidence: number; // Setup confidence (99% - distance penalty)
}

/**
 * Replicate Pine Script breakout logic exactly
 * Parameters match: len_fast_ma=20, len_slow_ma=50, len_trend_ma=200, min_structure_bars=5
 */
export function analyzeBreakout(data: MarketData): BreakoutAnalysis {
  const {
    ma20,
    ma50,
    ma150,
    ma200,
    close,
    open,
    volume,
    avgVolume,
    highs,
    lows,
    earningsGrowth = 0,
    epsGrowthPct = 0,
    revenueGrowthPct = 0,
    epsBeat = false,
    epsSurprisePct = 0,
    sector = "",
    industry = "",
    beta = 0,
    fedFundsRate = 5.25,
    barsInRange = 0,
    high52w = 0,
    priorBaseDays = 0,
    priorBaseRangePercent = 0,
    priorBreakoutBarsAgo = 0,
  } = data;
  const MIN_STRUCTURE_BARS = 5;
  const MIN_AVG_VOLUME = 100_000; // Liquidity filter

  // Donchian resistance/support (highest high / lowest low of last 20 bars)
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);

  // Volume check: volume >= avgVolume * 1.2
  const volumeOk = volume >= avgVolume * 1.2;

  // Liquidity check: 20-day avg volume >= 100k shares
  const liquidityOk = avgVolume >= MIN_AVG_VOLUME;

  // Proper uptrend: 200 < 150 < 50 < 20 (ascending MAs)
  const maStack = ma200 < ma150 && ma150 < ma50 && ma50 < ma20;

  // MAs are turning up (close to each other, ascending order)
  // This indicates recent bullish momentum especially in faster MAs
  const maDist20_50 = Math.abs(ma20 - ma50) / ma50;
  const maDist50_150 = Math.abs(ma50 - ma150) / ma150;
  const maStackTurning = maStack && maDist20_50 < 0.1 && maDist50_150 < 0.15;

  // Price above key MAs
  const aboveMA50 = close > ma50;
  const aboveMA200 = close > ma200;

  // Breakout: close above resistance
  const breakout = close > resistance;

  // Bullish candle: close > open
  const bullishCandle = close > open;

  // Good structure: above MAs + proper stack
  const goodStructure = aboveMA50 && aboveMA200 && maStack;

  // Consolidation check: must have spent min bars in range before breakout
  const consolidationOk = barsInRange >= MIN_STRUCTURE_BARS;

  // Final signal: breakout + structure + volume + bullish candle + consolidation
  const hasEarningsGrowth = earningsGrowth > 5;
  const breakoutSignal = breakout && goodStructure && volumeOk && bullishCandle;

  // PINE SCRIPT GREEN CONE: Fresh breakout with meaningful consolidation (prevents false signals on extensions)
  // Requires: breakout signal + strong consolidation (≥5 bars to avoid extension re-tests)
  const pineScriptGreen =
    breakoutSignal && consolidationOk && maStack && barsInRange >= 5;

  // Type 1 vs Type 3 classification
  // Type 1: Fresh breakout from real prior base with no recent prior breakout
  // Type 3: Just a continuation (has pineScriptGreen but no real prior base, or riding a prior breakout)
  let breakoutType: "Type1" | "Type3" | "unknown" = "unknown";

  if (pineScriptGreen && liquidityOk) {
    // Check Type 1 conditions
    const hasGoodPriorBase = priorBaseDays >= 15 && priorBaseRangePercent <= 35;
    const noRecentPriorBreakout =
      priorBreakoutBarsAgo === 0 || priorBreakoutBarsAgo > 45;

    if (hasGoodPriorBase && noRecentPriorBreakout) {
      breakoutType = "Type1";
    } else {
      breakoutType = "Type3";
    }
  } else if (breakoutSignal && maStack) {
    breakoutType = "Type3";
  }

  // Calculate confidence
  let confidence = 0.1; // base for weak/no signal

  if (breakoutType === "Type1") {
    // Fresh breakout from real base = 99% baseline
    let consolidationQuality = 0.99;

    const rangePercent = data.consolidationRangePercent || 0;
    if (rangePercent > 5) {
      const rangePenalty = (rangePercent - 5) / 100;
      consolidationQuality -= rangePenalty;
    }

    const volumePercent = data.consolidationVolumePercent || 0;
    if (volumePercent > 100) {
      const volumePenalty = (volumePercent - 100) / 100;
      consolidationQuality -= volumePenalty;
    }

    consolidationQuality = Math.max(0.8, consolidationQuality); // Floor at 80%
    confidence = consolidationQuality;
  } else if (breakoutType === "Type3") {
    // Continuation: start at 40%, degrade based on how long ago the real breakout was
    confidence = 0.4;
    if (priorBreakoutBarsAgo > 0) {
      const degradation = priorBreakoutBarsAgo * 0.005; // -0.5% per bar ago
      confidence = Math.max(0.2, confidence - degradation);
    }
  } else if (pineScriptGreen) {
    // Green cone signal but no liquidity = lower confidence
    let consolidationQuality = 0.8;
    const rangePercent = data.consolidationRangePercent || 0;
    if (rangePercent > 5) {
      const rangePenalty = (rangePercent - 5) / 100;
      consolidationQuality -= rangePenalty;
    }
    consolidationQuality = Math.max(0.5, consolidationQuality);
    confidence = consolidationQuality;
  } else if (breakoutSignal && maStack) {
    // Breakout + structure + volume, but missing consolidation or bullish candle
    confidence = 0.65; // Base confidence for valid breakout
    if (maStackTurning) confidence += 0.15; // Stronger momentum
    if (hasEarningsGrowth) confidence += 0.15; // Fundamental support
  } else if (breakout && goodStructure) {
    // Breakout with structure but missing volume or other conditions
    confidence = 0.25;
  } else if (goodStructure) {
    // Good structure but no breakout yet = setup, not trigger
    confidence = 0.15;
  }

  return {
    resistance,
    support,
    ma20,
    ma50,
    ma150,
    ma200,
    maStack,
    maStackTurning,
    barsInRange,
    volumeOk,
    breakoutSignal,
    bullishCandle,
    consolidationOk,
    pineScriptGreen,
    confidence: Math.min(0.99, Math.max(0.1, confidence)),
    high52w,
    earningsGrowth,
    epsGrowthPct,
    revenueGrowthPct,
    epsBeat,
    epsSurprisePct,
    sector,
    industry,
    beta,
    fedFundsRate,
    breakoutType,
    priorBaseDays,
    priorBaseRangePercent,
    priorBreakoutBarsAgo,
    liquidityOk,
  };
}

/**
 * Detect pre-breakout setups: consolidation with bullish MAs turning, low volume
 * These are "handles" or "bases" ready to break out
 * Confidence: 99% base, minus penalty for distance from 20 MA
 */
export function analyzeSetup(
  data: MarketData,
  breakout: BreakoutAnalysis,
): SetupAnalysis {
  const {
    ma20,
    close,
    setupBarsInRange = 0,
    setupConsolidationVolumePercent = 0,
  } = data;
  const { maStackTurning, breakoutSignal } = breakout;

  // Setup conditions: has tight consolidation but NOT breaking out yet
  // Must have setup consolidation bars (Type 2 specific, not Type 1 breakout detection)
  const hasSetupConsolidation = setupBarsInRange >= 3;
  const notBreakingOut = !breakoutSignal;
  const bullishMAs = maStackTurning;

  // Low volume during consolidation (< 80% of average)
  const lowVolumeConsolidation = (setupConsolidationVolumePercent || 0) < 80;

  const isSetup =
    hasSetupConsolidation &&
    notBreakingOut &&
    bullishMAs &&
    lowVolumeConsolidation;

  if (!isSetup) {
    return {
      isSetup: false,
      setupType: "none",
      distanceFromMA20: 0,
      distancePenalty: 0,
      confidence: 0,
    };
  }

  // Calculate distance from 20 MA
  const distanceFromMA20 = (Math.abs(close - ma20) / ma20) * 100;

  // Penalty for distance from 20 MA:
  // <= 5% away = no penalty
  // 5-10% away = -1% per 1% over 5%
  // > 10% away = steeper penalty (lose more points)
  let distancePenalty = 0;
  if (distanceFromMA20 > 5) {
    if (distanceFromMA20 <= 10) {
      distancePenalty = distanceFromMA20 - 5; // -1% per 1% over 5%
    } else {
      // Steeper penalty for >10% away (e.g., 12% away = 2 + (2*1.5) = 5% penalty)
      distancePenalty = 10 - 5 + (distanceFromMA20 - 10) * 1.5;
    }
  }

  const confidence = Math.max(0.8, 0.99 - distancePenalty / 100);

  return {
    isSetup: true,
    setupType: distanceFromMA20 < 3 ? "handle" : "base",
    distanceFromMA20,
    distancePenalty,
    confidence,
  };
}

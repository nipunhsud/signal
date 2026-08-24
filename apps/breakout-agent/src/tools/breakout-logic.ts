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
  // Type1  : fresh breakout from real base, ≥1.2x volume (green cone)
  // Type1b : same clean breakout but volume <1.2x — UI-only, not alerted
  // Type3  : continuation of a prior breakout (extension window or absorbed prior)
  // unknown: everything else
  breakoutType: "Type1" | "Type1b" | "Type3" | "unknown";
  priorBaseDays: number;
  priorBaseRangePercent: number;
  priorBreakoutBarsAgo: number;
  liquidityOk: boolean;
  // VCP mark (Minervini Volatility Contraction Pattern): a Type1 whose base was
  // tight in absolute terms, whose volatility was still contracting into the
  // pivot, and whose breakout bar expanded upward closing near its high.
  isVcp: boolean;
  atrPercent: number; // base ATR(14) as % of close (today's bar excluded)
  contractionRatio: number; // base ATR(5) / ATR(20) — <1 = contracting
  expansionRatio: number; // today's true range / base ATR(14)
}

export interface SetupAnalysis {
  isSetup: boolean; // Consolidation + bullish MAs + low volume (pre-breakout)
  setupType: "none" | "base" | "handle";
  distanceFromMA20: number; // % distance from 20 MA
  distancePenalty: number; // Confidence penalty for distance from MA20
  confidence: number; // Setup confidence (99% - distance penalty)
  // True only for handles tight enough to be a pre-breakout watchlist entry:
  // distance from MA20 < 3% AND ≥5 bars in range. "base" isSetups are counted
  // as market breadth only — the 10-bar detector can't identify real O'Neil
  // bases (25-35 bars), so we don't emit them as per-stock signals.
  qualifiesAsTradableHandle: boolean;
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
    high,
    low,
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
    atrPercent = 0,
    contractionRatio = 0,
    expansionRatio = 0,
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

  // Breakout: high breaches resistance (intrabar breach counts — a wick through
  // the level on volumeOk-confirmed volume is treated as the trigger, not just
  // a close above it).
  const breakout = high > resistance;

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

  // Classification:
  //   Type1  = green cone (clean consolidation + ≥1.2x volume) from a fresh base
  //   Type1b = clean consolidation + <1.2x volume; UI-only, no email alerts
  //   Type3  = continuation (extension detector or absorbed prior breakout)
  //   unknown = everything else (messy patterns, no clean setup)
  let breakoutType: "Type1" | "Type1b" | "Type3" | "unknown" = "unknown";

  // Extension: a breakout already happened in the last 5 bars and price is still
  // above that prior resistance. Today is a continuation regardless of whether
  // today itself triggers a fresh breakout signal.
  const extensionBarsAgo = data.extensionPriorBreakoutBarsAgo || 0;
  const isExtension = extensionBarsAgo > 0;

  const hasGoodPriorBase =
    priorBaseDays >= 15 && priorBaseRangePercent <= 30;
  // "No recent prior breakout" is true when: no prior breakout at all, one
  // that's already ≥45 bars old, OR a real base has since formed that spans
  // most of the time since the prior breakout — meaning the older breakout
  // rolled back, a new base built, and today is a fresh breakout of the new
  // base. Caught CROX 2026-07-10 where a 32-bar base absorbed a breakout
  // from 24 bars ago.
  const noRecentPriorBreakout =
    priorBreakoutBarsAgo === 0 ||
    priorBreakoutBarsAgo > 45 ||
    priorBaseDays >= priorBreakoutBarsAgo * 0.5;

  // A prior breakout price never fell below stays flagged as an extension
  // indefinitely (see market-data isExtension — no time window). That correctly
  // suppresses a slow grinder that never re-bases, but it must NOT bury a genuine
  // fresh breakout out of a NEW base (ZETA 2026-08-04: breakout 38 bars ago, yet a
  // new 16-day base had formed). Same predicate the Type1 branch below trusts, so
  // this only ever promotes cases that branch would already mint as Type1.
  const freshBreakoutFromNewBase =
    pineScriptGreen && liquidityOk && hasGoodPriorBase && noRecentPriorBreakout;

  if (isExtension && maStack && liquidityOk && !freshBreakoutFromNewBase) {
    breakoutType = "Type3";
  } else if (pineScriptGreen && liquidityOk) {
    if (hasGoodPriorBase && noRecentPriorBreakout) {
      breakoutType = "Type1";
    } else if (!noRecentPriorBreakout) {
      // Green cone riding a prior breakout within the last 45 bars — continuation.
      breakoutType = "Type3";
    }
  } else if (
    // Type1b: clean shape + breakout above 5-bar consolidation + goodStructure,
    // but volume <1.2x killed pineScriptGreen. Requires the same prior-base check
    // as Type1 so we don't relabel messy continuations as weak-vol breakouts.
    breakout &&
    goodStructure &&
    bullishCandle &&
    liquidityOk &&
    (data.cleanConsolidation ?? false) &&
    hasGoodPriorBase &&
    noRecentPriorBreakout
  ) {
    breakoutType = "Type1b";
  }
  // Everything else (high-vol messy consolidation, non-clean breakouts) stays "unknown".

  // VCP mark: only Type1 qualifies. Three gates on top of the Type1 rules —
  //   tight base:      ATR% < 2.5 (absolute, so an always-wild tape can't pass)
  //   contracting:     ATR(5)/ATR(20) < 0.75 — volatility shrinking INTO the pivot
  //   upside expansion: breakout bar's range ≥1.5x base ATR, close in top third
  // Metrics are 0 when <22 bars of history — a 0 fails the gates, never passes.
  const closeInTopThird = high > low ? (close - low) / (high - low) >= 0.67 : bullishCandle;
  const isVcp =
    breakoutType === "Type1" &&
    atrPercent > 0 &&
    atrPercent < 2.5 &&
    contractionRatio > 0 &&
    contractionRatio < 0.75 &&
    expansionRatio >= 1.5 &&
    closeInTopThird;

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
  } else if (breakoutType === "Type1b") {
    // Weak-volume clean breakout: same shape math as Type1 but capped at 85%
    // so it never outranks a true Type1 in the sorted list.
    let consolidationQuality = 0.85;
    const rangePercent = data.consolidationRangePercent || 0;
    if (rangePercent > 5) consolidationQuality -= (rangePercent - 5) / 100;
    const volumePercent = data.consolidationVolumePercent || 0;
    if (volumePercent > 100) consolidationQuality -= (volumePercent - 100) / 100;
    confidence = Math.max(0.6, Math.min(0.85, consolidationQuality));
  } else if (breakoutType === "Type3" && isExtension) {
    // Type 3 extension: real breakout was in the last ~5 bars. Inherit the Type 1
    // confidence by applying the same formula to the consolidation that preceded
    // that breakout — keeps confidence stable day-over-day post-breakout.
    let consolidationQuality = 0.99;

    const rangePercent =
      data.extensionConsolidationRangePercent ||
      data.consolidationRangePercent ||
      0;
    if (rangePercent > 5) {
      consolidationQuality -= (rangePercent - 5) / 100;
    }

    const volumePercent =
      data.extensionConsolidationVolumePercent ||
      data.consolidationVolumePercent ||
      0;
    if (volumePercent > 100) {
      consolidationQuality -= (volumePercent - 100) / 100;
    }

    consolidationQuality = Math.max(0.8, consolidationQuality);
    confidence = consolidationQuality;
  } else if (breakoutType === "Type3") {
    // Continuation of an older breakout: start at 40%, degrade by bars ago
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
    isVcp,
    atrPercent,
    contractionRatio,
    expansionRatio,
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
    ma50,
    close,
    setupBarsInRange = 0,
    setupConsolidationVolumePercent = 0,
    setupConsolidationRangePercent = 0,
  } = data;
  const { maStackTurning, breakoutSignal } = breakout;

  // Setup conditions: has tight consolidation but NOT breaking out yet
  // Must have setup consolidation bars (Type 2 specific, not Type 1 breakout detection)
  const hasSetupConsolidation = setupBarsInRange >= 3;
  // "Not breaking out" means neither today AND not in an active Type 3 extension.
  // Without the extension check, stocks that already broke out N days ago (and
  // whose volume dropped back below breakout threshold) re-qualify as setups.
  const notInExtension = (data.extensionPriorBreakoutBarsAgo || 0) === 0;
  const notBreakingOut = !breakoutSignal && notInExtension;
  const bullishMAs = maStackTurning;

  // Low volume during consolidation (< 80% of average)
  const lowVolumeConsolidation = (setupConsolidationVolumePercent || 0) < 80;

  // Price must be above 50MA: consolidation in uptrend, not downtrend
  const priceAboveMA50 = close > ma50;
  const priceAboveMA20 = close > ma20;

  const isSetup =
    hasSetupConsolidation &&
    notBreakingOut &&
    bullishMAs &&
    lowVolumeConsolidation &&
    priceAboveMA50;

  if (!isSetup) {
    return {
      isSetup: false,
      setupType: "none",
      distanceFromMA20: 0,
      distancePenalty: 0,
      confidence: 0,
      qualifiesAsTradableHandle: false,
    };
  }

  // Calculate distance from 20 MA
  const distanceFromMA20 = (Math.abs(close - ma20) / ma20) * 100;

  // Start confidence at 100%, deduct for inflections (choppy = lower quality)
  let confidence = 1.0;
  let distancePenalty = 0;

  // Each inflection (direction change) reduces confidence by 5%
  const setupInflections = data.setupInflectionCount || 0;
  confidence -= setupInflections * 0.05;

  // Penalty for wider consolidation range (> 5% = lower quality setup)
  const rangePercent = setupConsolidationRangePercent || 0;
  if (rangePercent > 3) {
    confidence -= (rangePercent - 3) * 0.03; // -3% per 1% of range beyond 3%
  }

  // Distance from 20MA penalty
  if (!priceAboveMA20) {
    if (distanceFromMA20 > 5) {
      if (distanceFromMA20 <= 10) {
        distancePenalty = distanceFromMA20 - 5;
      } else {
        distancePenalty = 10 - 5 + (distanceFromMA20 - 10) * 1.5;
      }
    }
    confidence -= distancePenalty / 100;
  }

  // Bonus for tight, smooth handles
  const isHandle = distanceFromMA20 < 3;
  if (isHandle && setupInflections <= 1) {
    confidence += 0.05; // Tight + smooth = bonus
  }

  // Ensure confidence is within bounds
  confidence = Math.max(0.1, Math.min(0.99, confidence));

  const qualifiesAsTradableHandle = isHandle && setupBarsInRange >= 5;

  return {
    isSetup: true,
    setupType: isHandle ? "handle" : "base",
    distanceFromMA20,
    distancePenalty,
    confidence,
    qualifiesAsTradableHandle,
  };
}

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
  // Base-quality metrics (20-bar base, today excluded)
  upDownVolumeRatio: number; // up-day vol / down-day vol — >1.5 = accumulation
  failedPokes: number; // wicks that reached the pivot but closed >1% below it
  coilRatio: number; // 2nd-half range / 1st-half — <1 = tightening
  isStaircase: boolean; // progressive thirds contraction — the VCP "road"
  isBlueSky: boolean; // pivot within 2% of the 52-week high — no overhead supply
  // Evidence cohort (full-history 8-cell grid, 20,061 bases, 1973-2026):
  //   S = sky + >=16wk base + >=2x vol   (67.2% win / 16% stopped, n=323)
  //   A = blue sky, any other mix        (56.7-59.6% win)
  //   B = no sky, but >=16wk AND >=2x    (47.2% win)
  //   C = everything else                (29-41% win, flat-to-negative means)
  cohort: "S" | "A" | "B" | "C" | null;
  // X-ray base grade (210k-breakout full-history validation, Sep 2026).
  // Structure + location ONLY — volume never gates a grade, it travels as
  // volumeTag. Requires close > 200MA (below it: 23.7% win / 82.7% stop-touch,
  // never actionable) and a blue-sky pivot (non-sky bases: 22.9-45.1% win —
  // dead at every slice tested). Tiered by length/depth:
  //   S  = >=80 bars, <=15% deep   (62.6% win / 11.6% stop-touch)
  //   A+ = >=25 bars, <=15% deep   (57.7% / 22.6%)
  //   A  = <=25% deep, any length  (54.8% / 32.1%)
  //   null = unqualified           (32.1% win / -4.5% mean)
  baseGrade: "S" | "A+" | "A" | null;
  // Volume character of today's bar: quiet <1.2x (steadier — 57.5% win / 22%
  // stop), confirmed 1.2-2x, power >=2x (bigger mean, bumpier — 32% stop).
  volumeTag: "quiet" | "confirmed" | "power";
  basePivot: number; // the X-ray base pivot — close-above trigger and frozen entry
  baseBarsCount: number;
  baseDepthPct: number;
  baseSky: boolean;
  // TODAY closed above the base pivot — the validated trigger (57.0% win vs
  // 22.8% entering on the intrabar poke; 81% of pokes are traps). This, plus
  // a non-null grade, is the alert condition.
  gradedBreakoutToday: boolean;
}

export interface SetupAnalysis {
  isSetup: boolean; // Consolidation + bullish MAs + low volume (pre-breakout)
  setupType: "none" | "base" | "handle";
  distanceFromMA20: number; // % distance from 20 MA
  distanceToPivotPct: number; // % below the pivot (Donchian resistance) — how far from trigger
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
    upDownVolumeRatio = 0,
    failedPokes = 0,
    coilRatio = 0,
    isStaircase = false,
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

  // VCP mark, recalibrated from the 2,074-base outcome study (Aug 2026): the
  // original ATR/dry-up gates selected a 35%-win cohort (extreme tightening and
  // volume dry-up both UNDERperformed). The winning combination measured:
  //   moderate coil 0.7–0.9 (tightening, but not deal-pinned-tape tight)
  //   breakout volume ≥ 2x average (outcomes scale with volume; 1.2x is noise)
  // → 49.8% win rate, +7.9% mean 20-bar return vs 44.3%/+3.5% baseline.
  const isVcp =
    breakoutType === "Type1" &&
    coilRatio >= 0.7 &&
    coilRatio < 0.9 &&
    avgVolume > 0 &&
    volume >= avgVolume * 2;

  // Blue sky: the pivot sits at (within 2% of) the 52-week high, so a breakout
  // clears every holder from the past year — no trapped sellers overhead.
  const isBlueSky = high52w > 0 && resistance >= high52w * 0.98;

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

    // Evidence-based adjustments (2,074-base study, Aug 2026):
    // - Blue sky: 53.0% win / 28% stopped vs 35.0% / 55% for buried bases —
    //   the strongest single factor. Context matters more than shape.
    // - Base age ≥16 weeks (~80 bars): best bucket in the study, 58.8% win.
    // - 10-20% depth: the worst pocket (39.3% win) — shallower is safe,
    //   deeper is boom-or-bust, this middle band is just bad.
    if (isBlueSky) confidence = Math.min(0.99, confidence + 0.04);
    if (priorBaseDays >= 80) confidence = Math.min(0.99, confidence + 0.04);
    if (priorBaseRangePercent >= 10 && priorBaseRangePercent < 20) {
      confidence = Math.max(0.5, confidence - 0.05);
    }
    // Shallow is contextual, not good per se: shallow AT blue sky wins 56.5%,
    // but shallow-and-buried wins just 26.0% (median -8) — a tight base far
    // below the highs is usually a weak bounce, not quiet accumulation.
    if (priorBaseRangePercent > 0 && priorBaseRangePercent < 10 && !isBlueSky) {
      confidence = Math.max(0.5, confidence - 0.06);
    }
    // The "road" bonus: staircase alone predicts nothing, but inside the VCP
    // gate it stratifies 59.6% vs 50.7% win (n=52 — bonus, not a hard gate,
    // until live data grows the sample).
    if (isVcp && isStaircase) confidence = Math.min(0.99, confidence + 0.03);
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

  // Cohort grade for fresh breakouts (Type1/1b) from the measured factor grid
  // (full-history study, 20,061 bases): S = sky+long+loud 67.2% win · A = any
  // blue sky 56.7-59.6% · B = long+loud without sky 47.2% · C = rest 29-41%.
  let cohort: "S" | "A" | "B" | "C" | null = null;
  if (breakoutType === "Type1" || breakoutType === "Type1b") {
    const longBase = priorBaseDays >= 80;
    const loudVol = avgVolume > 0 && volume >= avgVolume * 2;
    cohort = isBlueSky && longBase && loudVol ? "S" : isBlueSky ? "A" : longBase && loudVol ? "B" : "C";
  }

  // X-ray base grade + volume tag (see interface for the validated numbers).
  const gb = data.gradedBase;
  const volumeTag: "quiet" | "confirmed" | "power" =
    avgVolume > 0 && volume >= avgVolume * 2
      ? "power"
      : avgVolume > 0 && volume >= avgVolume * 1.2
        ? "confirmed"
        : "quiet";
  let baseGrade: "S" | "A+" | "A" | null = null;
  if (gb && gb.sky && close > ma200 && gb.depthPct <= 25) {
    baseGrade =
      gb.depthPct <= 15 && gb.bars >= 80
        ? "S"
        : gb.depthPct <= 15 && gb.bars >= 25
          ? "A+"
          : "A";
  }
  const gradedBreakoutToday = !!(gb && gb.brokeOutToday);

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
    upDownVolumeRatio,
    failedPokes,
    coilRatio,
    isStaircase,
    isBlueSky,
    cohort,
    baseGrade,
    volumeTag,
    basePivot: gb?.pivot ?? 0,
    baseBarsCount: gb?.bars ?? 0,
    baseDepthPct: gb?.depthPct ?? 0,
    baseSky: gb?.sky ?? false,
    gradedBreakoutToday,
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

  // How far price sits below the pivot — the honest "distance to trigger"
  const distanceToPivotPct =
    breakout.resistance > 0
      ? ((breakout.resistance - close) / close) * 100
      : 0;

  if (!isSetup) {
    return {
      isSetup: false,
      setupType: "none",
      distanceFromMA20: 0,
      distanceToPivotPct,
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
    distanceToPivotPct,
    distancePenalty,
    confidence,
    qualifiesAsTradableHandle,
  };
}

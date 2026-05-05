import { MarketData } from './market-data';

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
}

/**
 * Replicate Pine Script breakout logic exactly
 * Parameters match: len_fast_ma=20, len_slow_ma=50, len_trend_ma=200, min_structure_bars=5
 */
export function analyzeBreakout(data: MarketData): BreakoutAnalysis {
  const { ma20, ma50, ma150, ma200, close, open, volume, avgVolume, highs, lows, earningsGrowth = 0, epsGrowthPct = 0, revenueGrowthPct = 0, epsBeat = false, epsSurprisePct = 0, sector = '', industry = '', beta = 0, fedFundsRate = 5.25, barsInRange = 0, high52w = 0 } = data;
  const MIN_STRUCTURE_BARS = 5;

  // Donchian resistance/support (highest high / lowest low of last 20 bars)
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);

  // Volume check: volume >= avgVolume * 1.2
  const volumeOk = volume >= avgVolume * 1.2;

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

  // PINE SCRIPT GREEN CONE: ALL conditions met = 99% base, adjusted for consolidation quality
  const pineScriptGreen = breakoutSignal && consolidationOk && maStack;

  // Calculate confidence - 99% ONLY when Pine Script green cone (all conditions met)
  let confidence = 0.1; // base for weak/no signal

  if (pineScriptGreen) {
    // All conditions met: full Pine Script signal = green cone on TradingView
    // Apply dual penalties:
    // 1. Range penalty: -1% per 1% over 5% (e.g., 9% range = -4%)
    // 2. Volume penalty: -1% per 1% over 100% (e.g., 105% volume = -5%)
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
  };
}



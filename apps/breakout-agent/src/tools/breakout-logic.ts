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
  confidence: number;
  earningsGrowth: number;
}

/**
 * Replicate Pine Script breakout logic
 * Parameters match: len_fast_ma=20, len_slow_ma=50, len_trend_ma=200, etc.
 */
export function analyzeBreakout(data: MarketData): BreakoutAnalysis {
  const { ma20, ma50, ma150, ma200, close, volume, avgVolume, highs, lows, earningsGrowth = 0 } = data;

  // Donchian resistance/support (highest high / lowest low of last 20 bars)
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);

  // Volume check
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

  // Good structure: above MAs + proper stack
  const goodStructure = aboveMA50 && aboveMA200 && maStack;

  // Final signal: breakout + structure + volume + earnings growth
  const hasEarningsGrowth = earningsGrowth > 5;
  const breakoutSignal = breakout && goodStructure && volumeOk;

  // Calculate confidence - high only when ALL breakout conditions are met
  // Crucially: no high confidence without maStack (must be in uptrend)
  let confidence = 0.1; // base for weak/no signal

  if (breakoutSignal && maStack) {
    // All conditions met: proper uptrend + breakout + volume
    confidence = 0.65; // Base confidence for valid breakout
    if (maStackTurning) confidence += 0.15; // Stronger momentum
    if (hasEarningsGrowth) confidence += 0.15; // Fundamental support
  } else if (breakout && goodStructure) {
    // Breakout with structure but no full uptrend = weak signal
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
    barsInRange: 0,
    volumeOk,
    breakoutSignal,
    confidence: Math.min(0.95, Math.max(0.1, confidence)),
    earningsGrowth,
  };
}



import { fetchMarketData } from './tools/market-data.js';
import { analyzeBreakout, analyzeSetup } from './tools/breakout-logic.js';
import { sendEmail } from './email.js';
import { db } from './db.js';
import { getConfig } from './config.js';

function getSectorTailwind(sector: string): string {
  const map: Record<string, string> = {
    Technology: 'AI adoption & cloud expansion',
    Semiconductors: 'AI chip demand cycle',
    Healthcare: 'GLP-1 drug cycle & aging demographics',
    Energy: 'Energy transition & LNG demand',
    Financials: 'Rate normalization cycle',
    'Consumer Cyclical': 'Post-rate-cut spending recovery',
    Industrials: 'Reshoring & infrastructure spend',
  };
  for (const [key, val] of Object.entries(map)) {
    if (sector.includes(key)) return val;
  }
  return '';
}

export interface BreakoutResult {
  asset: string;
  timestamp: Date;
  resistance: number;
  support: number;
  currentPrice: number;
  volume: number;
  avgVolume: number;
  confidence: number;
  reasoning: string;
  shouldAlert: boolean;
}

type Config = ReturnType<typeof getConfig>;

export class BreakoutAgent {
  constructor() {}


  // 5 parallel tiers × 3 concurrency = 15 assets in flight
  // Rate limiter (750/min = 12.5 calls/sec) queues FMP calls fairly
  // Cache reduces actual API calls by 60-70%, so even safer
  async analyzeMarkets(assets: string[]): Promise<BreakoutResult[]> {
    const config = getConfig();
    const CONCURRENCY = 3;
    const results: BreakoutResult[] = [];

    for (let i = 0; i < assets.length; i += CONCURRENCY) {
      const batch = assets.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(asset => this.analyzeAsset(asset, config))
      );
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) results.push(r.value);
      }
    }

    return results;
  }

  private async analyzeAsset(asset: string, config: Config): Promise<BreakoutResult | null> {
    try {
      const data = await fetchMarketData(asset, config.dataSource, config.ibkrBaseUrl);
      const breakoutAnalysis = analyzeBreakout(data);
      const setupAnalysis = analyzeSetup(data, breakoutAnalysis);

      const volumeRatio = data.volume / data.avgVolume;
      const volumeIncreasing = volumeRatio > 1.3;

      let confidence = breakoutAnalysis.confidence;

      // If Pine Script green cone (all conditions met), confidence is 99%
      if (breakoutAnalysis.pineScriptGreen) {
        confidence = 0.99;
      } else {
        // Otherwise, apply additional confidence adjustments
        if (breakoutAnalysis.breakoutSignal) {
          if (breakoutAnalysis.maStackTurning && volumeIncreasing) confidence += 0.1;
          if (breakoutAnalysis.earningsGrowth > 10) confidence += 0.08;
        }

        // Boost/penalize based on proximity to 52-week high
        const distFrom52wHigh = breakoutAnalysis.high52w > 0
          ? (breakoutAnalysis.high52w - data.close) / breakoutAnalysis.high52w * 100
          : null;

        if (distFrom52wHigh !== null) {
          if (distFrom52wHigh <= 10) {
            confidence += 0.08; // within 10% of 52w high — near breakout territory
          } else if (distFrom52wHigh > 35) {
            confidence -= 0.15; // far below 52w high — weak setup
          }
        }

        // Only clamp when NOT using pineScriptGreen (which is always 0.99)
        confidence = Math.min(0.95, Math.max(0.2, confidence));
      }

      const isValid = breakoutAnalysis.maStack && breakoutAnalysis.volumeOk;

      const macroContext = breakoutAnalysis.fedFundsRate
        ? breakoutAnalysis.fedFundsRate > 4.5
          ? `Fed ${breakoutAnalysis.fedFundsRate.toFixed(2)}% — headwind for growth`
          : breakoutAnalysis.fedFundsRate > 2.5
          ? `Fed ${breakoutAnalysis.fedFundsRate.toFixed(2)}% — neutral`
          : `Fed ${breakoutAnalysis.fedFundsRate.toFixed(2)}% — tailwind for growth`
        : 'Macro: unavailable';

      const sectorTailwind = getSectorTailwind(breakoutAnalysis.sector || '');

      const distFrom52wHigh = breakoutAnalysis.high52w > 0
        ? (breakoutAnalysis.high52w - data.close) / breakoutAnalysis.high52w * 100
        : null;

      const localReasoning = [
        `MA Stack: ${breakoutAnalysis.maStack ? 'Uptrend ✓' : 'No uptrend ✗'}`,
        `Vol: ${volumeRatio.toFixed(1)}x${volumeIncreasing ? ' ✓' : ''}`,
        distFrom52wHigh !== null ? `52wH: ${distFrom52wHigh.toFixed(1)}% below` : null,
        `EPS: ${breakoutAnalysis.epsGrowthPct !== 0 ? (breakoutAnalysis.epsGrowthPct > 0 ? '+' : '') + breakoutAnalysis.epsGrowthPct.toFixed(1) + '%' : 'N/A'}`,
        `Rev: ${breakoutAnalysis.revenueGrowthPct !== 0 ? (breakoutAnalysis.revenueGrowthPct > 0 ? '+' : '') + breakoutAnalysis.revenueGrowthPct.toFixed(1) + '%' : 'N/A'}`,
        breakoutAnalysis.epsBeat !== false ? `EPS: ${breakoutAnalysis.epsBeat ? 'Beat' : 'Miss'} ${breakoutAnalysis.epsSurprisePct !== 0 ? (breakoutAnalysis.epsSurprisePct > 0 ? '+' : '') + breakoutAnalysis.epsSurprisePct.toFixed(1) + '%' : ''}` : null,
        `Sector: ${breakoutAnalysis.sector || 'Unknown'}${breakoutAnalysis.industry ? ' / ' + breakoutAnalysis.industry : ''}`,
        `Macro: ${macroContext}`,
        sectorTailwind ? `Tailwind: ${sectorTailwind}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      const shouldAlert = isValid && confidence > 0.6 && breakoutAnalysis.maStack && breakoutAnalysis.breakoutSignal;

      const result: BreakoutResult = {
        asset,
        timestamp: new Date(),
        resistance: breakoutAnalysis.resistance,
        support: breakoutAnalysis.support,
        currentPrice: data.close,
        volume: data.volume,
        avgVolume: data.avgVolume,
        confidence,
        reasoning: localReasoning,
        shouldAlert,
      };

      await db.breakoutSignal.create({
        data: {
          asset,
          confidence,
          agentDecision: localReasoning,
          shouldAlert,
          resistance: result.resistance,
          support: result.support,
          currentPrice: result.currentPrice,
          pineScriptGreen: breakoutAnalysis.pineScriptGreen,
          barsInRange: breakoutAnalysis.barsInRange || 0,
          bullishCandle: breakoutAnalysis.bullishCandle,
          epsGrowthPct: breakoutAnalysis.epsGrowthPct,
          revenueGrowthPct: breakoutAnalysis.revenueGrowthPct,
          epsBeat: breakoutAnalysis.epsBeat,
          epsSurprisePct: breakoutAnalysis.epsSurprisePct,
          sector: breakoutAnalysis.sector,
          industry: breakoutAnalysis.industry,
          fedFundsRate: breakoutAnalysis.fedFundsRate,
          volumeRatio,
        },
      });

      // Store setup signals (Type 2 green cone) in Signal table with metadata
      if (setupAnalysis.isSetup) {
        await db.signal.create({
          data: {
            agentName: 'BreakoutAgent',
            asset,
            signalType: `setup-${setupAnalysis.setupType}`,
            confidence: setupAnalysis.confidence,
            shouldAlert: setupAnalysis.confidence > 0.85,
            metadata: {
              setupType: setupAnalysis.setupType,
              distanceFromMA20: setupAnalysis.distanceFromMA20,
              distancePenalty: setupAnalysis.distancePenalty,
              ma20: data.ma20,
              currentPrice: data.close,
              barsInRange: data.setupBarsInRange,
              setupConsolidationRangePercent: data.setupConsolidationRangePercent,
              setupConsolidationVolumePercent: data.setupConsolidationVolumePercent,
            },
          },
        });
      }

      return result;
    } catch (error) {
      console.error(`Error analyzing ${asset}:`, error);
      return null;
    }
  }

  async sendAlert(result: BreakoutResult): Promise<void> {
    const subject = `🚀 Breakout Alert: ${result.asset}`;
    const body = `
Asset: ${result.asset}
Price: $${result.currentPrice}
Resistance: $${result.resistance}
Confidence: ${(result.confidence * 100).toFixed(0)}%

Reasoning: ${result.reasoning}

Source: Signal Forge - Breakout Agent
Time: ${result.timestamp.toISOString()}
    `;

    await sendEmail(subject, body);
  }
}

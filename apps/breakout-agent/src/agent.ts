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

  async fetchAssetsFromFMP(): Promise<string[]> {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) throw new Error('FMP_API_KEY not set');

    const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX']);

    try {
      console.log('[FMP] Fetching US asset lists...');
      const startTime = Date.now();

      const [stocksRes, etfsRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/api/v3/available-traded/list?apikey=${apiKey}`),
        fetch(`https://financialmodelingprep.com/api/v3/etf/list?apikey=${apiKey}`)
      ]);

      if (!stocksRes.ok || !etfsRes.ok) {
        throw new Error(`FMP API error: stocks=${stocksRes.status}, etfs=${etfsRes.status}`);
      }

      interface FMPAsset {
        symbol: string;
        exchangeShortName?: string;
        type?: string;
      }

      const stocksData = (await stocksRes.json()) as FMPAsset[];
      const etfsData = (await etfsRes.json()) as FMPAsset[];

      // Filter to US exchanges only
      const stockSymbols = (Array.isArray(stocksData) ? stocksData : [])
        .filter((s) => US_EXCHANGES.has(s.exchangeShortName || ''))
        .map((s) => s.symbol)
        .filter(Boolean);

      const etfSymbols = (Array.isArray(etfsData) ? etfsData : [])
        .filter((e) => US_EXCHANGES.has(e.exchangeShortName || ''))
        .map((e) => e.symbol)
        .filter(Boolean);

      const allAssets = [...new Set([...stockSymbols, ...etfSymbols])];

      const elapsed = Date.now() - startTime;
      console.log(`[FMP] Fetched ${allAssets.length} US assets (${stockSymbols.length} stocks + ${etfSymbols.length} ETFs) in ${elapsed}ms`);

      return allAssets;
    } catch (error) {
      console.error('[FMP] Asset fetch failed:', error);
      throw error;
    }
  }

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

      // Type 1 (fresh breakout from real base): apply extension penalty
      if (breakoutAnalysis.breakoutType === 'Type1' && breakoutAnalysis.resistance > 0) {
        const extensionFromResistance = (data.close - breakoutAnalysis.resistance) / breakoutAnalysis.resistance * 100;
        if (extensionFromResistance > 1) {
          if (extensionFromResistance <= 3) {
            confidence -= (extensionFromResistance - 1) * 0.01; // -1% per 1% above 1%
          } else if (extensionFromResistance <= 5) {
            confidence -= (2 + (extensionFromResistance - 3) * 0.015); // steeper
          } else {
            confidence -= (2.3 + (extensionFromResistance - 5) * 0.02); // even steeper for >5%
          }
          confidence = Math.max(0.80, confidence); // Type 1 floor at 80%
        }
      } else if (breakoutAnalysis.breakoutType === 'Type3') {
        // Type 3 (continuation): use pre-calculated confidence, no further adjustments
        // Confidence already degraded in analyzeBreakout based on bars ago
      } else if (breakoutAnalysis.breakoutSignal) {
        // Non-green-cone breakout signal: apply additional adjustments
        if (breakoutAnalysis.maStackTurning && volumeIncreasing) confidence += 0.1;
        if (breakoutAnalysis.earningsGrowth > 10) confidence += 0.08;

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

        // Penalize if too far above 20-day MA (extended run-up)
        const distFromMA20 = (data.close - breakoutAnalysis.ma20) / breakoutAnalysis.ma20 * 100;
        if (distFromMA20 > 1) {
          if (distFromMA20 <= 3) {
            confidence -= 0.02; // 1-3% above MA20 = -2%
          } else {
            confidence -= 0.04; // >3% above MA20 = -4%
          }
        }

        // Penalize if extended far above breakout resistance (original entry point)
        if (breakoutAnalysis.resistance > 0) {
          const extensionFromResistance = (data.close - breakoutAnalysis.resistance) / breakoutAnalysis.resistance * 100;
          if (extensionFromResistance > 2) {
            if (extensionFromResistance <= 5) {
              confidence -= (extensionFromResistance - 2) * 0.01; // -1% per 1% above 2%
            } else {
              confidence -= (3 + (extensionFromResistance - 5) * 0.015); // steeper for >5%
            }
          }
        }

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

      // Only Type 1 fresh breakouts trigger alerts
      const isType1Breakout = breakoutAnalysis.breakoutType === 'Type1';
      const shouldAlert = isType1Breakout && isValid && confidence > 0.85 && breakoutAnalysis.maStack && breakoutAnalysis.breakoutSignal;

      // Debug logging for breakout classification
      if (breakoutAnalysis.pineScriptGreen) {
        const reasons = [];
        if (breakoutAnalysis.breakoutType !== 'Type1') reasons.push(`Type ${breakoutAnalysis.breakoutType}`);
        if (breakoutAnalysis.breakoutType === 'Type3' && breakoutAnalysis.priorBreakoutBarsAgo > 0) {
          reasons.push(`riding ${breakoutAnalysis.priorBreakoutBarsAgo} bars old breakout`);
        }
        if (!breakoutAnalysis.liquidityOk) reasons.push(`illiquid (vol:${(data.avgVolume || 0).toFixed(0)})`);
        if (!isValid) reasons.push(`invalid (maStack:${breakoutAnalysis.maStack} volumeOk:${breakoutAnalysis.volumeOk})`);
        if (confidence <= 0.85) reasons.push(`confidence:${(confidence*100).toFixed(0)}%`);
        if (!breakoutAnalysis.breakoutSignal) reasons.push('no breakout signal');
        if (breakoutAnalysis.breakoutType === 'Type3' && !shouldAlert) {
          console.log(`⊘ ${asset}: Type 3 continuation (${reasons.join(', ')}) — tracked but not alerted`);
        } else if (!shouldAlert && reasons.length) {
          console.log(`⚠ ${asset} green cone detected but no alert: ${reasons.join(', ')}`);
        }
      }

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
          assetType: data.assetType,
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
          expenseRatio: data.expenseRatio,
          assetUnderManagement: data.assetUnderManagement,
          etfCategory: data.etfCategory,
          breakoutType: breakoutAnalysis.breakoutType,
          priorBaseDays: breakoutAnalysis.priorBaseDays,
          priorBaseRangePercent: breakoutAnalysis.priorBaseRangePercent,
          priorBreakoutBarsAgo: breakoutAnalysis.priorBreakoutBarsAgo,
          liquidityOk: breakoutAnalysis.liquidityOk,
        },
      });

      // Store setup signals (Type 2 green cone) in Signal table with metadata
      if (setupAnalysis.isSetup) {
        const setupReasoning = [
          `Setup Type: ${setupAnalysis.setupType}`,
          `MA Stack: ${breakoutAnalysis.maStack ? 'Uptrend ✓' : 'No uptrend ✗'}`,
          `Distance from MA20: ${setupAnalysis.distanceFromMA20.toFixed(2)}%`,
          `Consolidation: ${data.setupBarsInRange || 0} bars`,
          `Range: ${data.setupConsolidationRangePercent || 0}%`,
          `Volume: ${data.setupConsolidationVolumePercent || 0}% of avg`,
        ].join(' | ');

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
              agentDecision: setupReasoning,
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
    // Check if we already sent an alert for this asset
    const existingAlert = await db.breakoutSignal.findFirst({
      where: { asset: result.asset, alertSentAt: { not: null } },
      orderBy: { alertSentAt: 'desc' },
    });

    const now = new Date();

    // If alert was already sent, only re-alert if price moved ±2% or more
    if (existingAlert && existingAlert.lastAlertPrice) {
      const priceChange = Math.abs((result.currentPrice - existingAlert.lastAlertPrice) / existingAlert.lastAlertPrice) * 100;
      const shouldRealert = priceChange >= 2;

      if (!shouldRealert) {
        console.log(`⊘ Skip re-alert ${result.asset}: Price change ${priceChange.toFixed(2)}% < 2% threshold`);
        return;
      }

      console.log(`↻ Re-alert ${result.asset}: Price moved ${priceChange.toFixed(2)}% (from $${existingAlert.lastAlertPrice} to $${result.currentPrice})`);
    }

    // Get asset type from database record for indicator
    const record = await db.breakoutSignal.findFirst({
      where: { asset: result.asset },
      orderBy: { createdAt: 'desc' },
    });
    const assetTypeIndicator = record?.assetType === 'etf' ? '📊 ETF' : '📈 STOCK';
    const etfInfo = record?.assetType === 'etf' && record?.expenseRatio
      ? `\nExpense Ratio: ${record.expenseRatio}%`
      : '';

    const subject = `🚀 Breakout Alert: ${result.asset} [${assetTypeIndicator}]`;
    const tradingViewUrl = `https://www.tradingview.com/chart/WgVJPfij/?symbol=${result.asset}`;
    const body = `
Asset: ${result.asset} ${assetTypeIndicator}
Price: $${result.currentPrice}
Resistance: $${result.resistance}
Confidence: ${(result.confidence * 100).toFixed(0)}%${etfInfo}

Reasoning: ${result.reasoning}

TradingView: ${tradingViewUrl}

Source: Signal Forge - Breakout Agent
Time: ${result.timestamp.toISOString()}
    `;

    await sendEmail(subject, body);

    // Update alert tracking
    await db.breakoutSignal.updateMany({
      where: { asset: result.asset },
      data: {
        alertSentAt: existingAlert?.alertSentAt || now,
        lastAlertPrice: result.currentPrice,
        lastAlertAt: now,
      },
    });

    console.log(`✓ Alert sent: ${result.asset} @ $${result.currentPrice}`);
  }
}

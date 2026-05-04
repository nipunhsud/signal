import { TradeAgent } from '@signal-forge/core';
import { fetchMarketData } from './tools/market-data.js';
import { analyzeBreakout } from './tools/breakout-logic.js';
import { sendEmail } from './email.js';
import { db } from './db.js';
import { getConfig } from './config.js';

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
  private agent: TradeAgent;

  constructor() {
    this.agent = new TradeAgent({
      name: 'BreakoutAgent',
      description: 'Detects bullish breakout signals with macro context',
      model: 'gemini-2.5-flash',
    });
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

      let confidence = breakoutAnalysis.confidence;
      const volumeRatio = data.volume / data.avgVolume;
      const volumeIncreasing = volumeRatio > 1.3;

      if (breakoutAnalysis.breakoutSignal) {
        if (breakoutAnalysis.maStackTurning && volumeIncreasing) confidence += 0.1;
        if (breakoutAnalysis.earningsGrowth > 10) confidence += 0.08;
      }
      confidence = Math.min(0.95, Math.max(0.2, confidence));

      const isValid = breakoutAnalysis.maStack && breakoutAnalysis.volumeOk;
      const localReasoning = `${breakoutAnalysis.maStack ? 'Uptrend' : 'No uptrend'} | Vol ${volumeRatio.toFixed(1)}x | Earnings ${breakoutAnalysis.earningsGrowth > 0 ? '+' : ''}${breakoutAnalysis.earningsGrowth.toFixed(1)}%`;

      let agentDecision = localReasoning;
      let finalConfidence = confidence;

      if (confidence > 0.9) {
        try {
          const prompt = `You are a trading analyst evaluating ${asset} for a breakout trade.

Technical setup:
- MA Stack (200<150<50<20, proper uptrend): ${breakoutAnalysis.maStack ? 'YES' : 'NO'}
- MAs turning up: ${breakoutAnalysis.maStackTurning ? 'YES' : 'NO'}
- Volume vs avg: ${volumeRatio.toFixed(1)}x (${volumeRatio > 1.3 ? 'strong surge' : 'normal'})
- Earnings growth YoY: ${breakoutAnalysis.earningsGrowth > 0 ? '+' : ''}${breakoutAnalysis.earningsGrowth.toFixed(1)}%
- Current confidence: ${Math.round(confidence * 100)}%
- Price breaking above resistance: ${breakoutAnalysis.breakoutSignal ? 'YES' : 'NO'}

Search for recent news on ${asset}: analyst upgrades/downgrades, earnings beats/misses, product launches, macro tailwinds, or any catalyst.

Respond in 2-3 sentences: assess conviction. If strong catalyst found, boost confidence to 0.95. If concerns found, lower to 0.80. Otherwise keep at ${Math.round(confidence * 100)}%.`;

          const response = await this.agent.run(prompt, undefined, true);
          agentDecision = response.raw || response.reasoning || localReasoning;

          if (agentDecision.includes('0.95')) finalConfidence = 0.95;
          else if (agentDecision.includes('0.80')) finalConfidence = 0.80;
        } catch (error) {
          console.warn(`Gemini call failed for ${asset}, skipping LLM enhancement:`, error);
        }
      }

      const shouldAlert = isValid && finalConfidence > 0.6 && breakoutAnalysis.maStack && breakoutAnalysis.breakoutSignal;

      const result: BreakoutResult = {
        asset,
        timestamp: new Date(),
        resistance: breakoutAnalysis.resistance,
        support: breakoutAnalysis.support,
        currentPrice: data.close,
        volume: data.volume,
        avgVolume: data.avgVolume,
        confidence: finalConfidence,
        reasoning: localReasoning,
        shouldAlert,
      };

      await db.breakoutSignal.create({
        data: {
          asset,
          confidence: finalConfidence,
          agentDecision,
          shouldAlert,
          resistance: result.resistance,
          support: result.support,
          currentPrice: result.currentPrice,
        },
      });

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

import axios from 'axios';
import { analyzeBreakout } from './dist/tools/breakout-logic.js';

async function fullBacktestCorrect(symbol) {
  const apiKey = 'e5ccbcc74abe54698f96836dd4c51d48';

  try {
    const response = await axios.get(
      `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}?apikey=${apiKey}`,
      { timeout: 10000 }
    );

    const sorted = response.data.historical.sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const calcMA = (prices, period) => {
      if (prices.length < period) return prices[prices.length - 1];
      return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
    };

    const detectPriorBase = (allBars, currentIdx) => {
      if (allBars.length < 100) return { priorBaseDays: 0, priorBaseRangePercent: 0 };
      const maxLookback = Math.min(100, allBars.length - 6);
      const priorWindow = allBars.slice(Math.max(0, currentIdx - maxLookback), currentIdx - 6);
      if (priorWindow.length < 12) return { priorBaseDays: 0, priorBaseRangePercent: 0 };

      let maxBaseBars = 0, bestBaseHigh = 0, bestBaseLow = 0;
      for (let winSize = priorWindow.length; winSize >= 12; winSize--) {
        for (let i = 0; i <= priorWindow.length - winSize; i++) {
          const windowBars = priorWindow.slice(i, i + winSize);
          const high = Math.max(...windowBars.map((b) => b.high));
          const low = Math.min(...windowBars.map((b) => b.low));
          const rangePercent = ((high - low) / low) * 100;
          if (rangePercent <= 20 && winSize > maxBaseBars) {
            maxBaseBars = winSize;
            bestBaseHigh = high;
            bestBaseLow = low;
          }
        }
        if (maxBaseBars > 0) break;
      }
      if (maxBaseBars >= 12) {
        return {
          priorBaseDays: maxBaseBars,
          priorBaseRangePercent: ((bestBaseHigh - bestBaseLow) / bestBaseLow) * 100,
        };
      }
      return { priorBaseDays: 0, priorBaseRangePercent: 0 };
    };

    const detectPriorBreakout = (allBars, currentIdx) => {
      if (allBars.length < 70) return { priorBreakoutBarsAgo: 0 };
      const priorWindow = allBars.slice(Math.max(0, currentIdx - 65), currentIdx - 5);
      if (priorWindow.length < 20) return { priorBreakoutBarsAgo: 0 };

      let mostRecentBreakoutBarsAgo = 0;
      for (let i = 20; i < priorWindow.length; i++) {
        const b = priorWindow[i];
        const historyBars = priorWindow.slice(Math.max(0, i - 20), i);
        const rollingHigh = Math.max(...historyBars.map((b) => b.high));
        const rollingAvgVol = historyBars.reduce((sum, b) => sum + b.volume, 0) / historyBars.length;
        if (b.close > rollingHigh && b.volume >= rollingAvgVol * 1.5) {
          mostRecentBreakoutBarsAgo = priorWindow.length - 1 - i;
        }
      }
      return { priorBreakoutBarsAgo: mostRecentBreakoutBarsAgo };
    };

    const alerts = [];

    for (let i = 200; i < sorted.length; i++) {
      const bar = sorted[i];
      const allBars = sorted.slice(0, i + 1);

      const closes = allBars.map((b) => b.close);
      const volumes = allBars.map((b) => b.volume);
      
      const bars = allBars.slice(-21);
      const history = bars.slice(0, 20);
      const highs = history.map((b) => b.high);
      const lows = history.map((b) => b.low);
      
      const ma20 = calcMA(closes, 20);
      const ma50 = calcMA(closes, 50);
      const ma150 = calcMA(closes, 150);
      const ma200 = calcMA(closes, 200);
      const avgVolume = history.reduce((sum, b) => sum + b.volume, 0) / 20;

      // Consolidation
      let barsInRange = 0;
      if (allBars.length >= 6) {
        const prev5 = allBars.slice(-6, -1);
        const consolidationHigh = Math.max(...prev5.map((b) => b.high));
        const avgVol = allBars.slice(-20).reduce((s, b) => s + b.volume, 0) / 20;
        if (bar.close > consolidationHigh && bar.volume >= avgVol * 1.2) {
          barsInRange = 5;
        }
      }

      // Prior base and breakout
      const priorBase = detectPriorBase(allBars, i);
      const priorBreakout = detectPriorBreakout(allBars, i);

      const analysis = analyzeBreakout({
        asset: symbol,
        assetType: 'stock',
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        avgVolume,
        timestamp: new Date(bar.date),
        highs,
        lows,
        ma20, ma50, ma150, ma200,
        barsInRange,
        priorBaseDays: priorBase.priorBaseDays,
        priorBaseRangePercent: priorBase.priorBaseRangePercent,
        priorBreakoutBarsAgo: priorBreakout.priorBreakoutBarsAgo,
      });

      if (analysis.confidence > 0.90) {
        alerts.push({
          date: bar.date,
          price: bar.close,
          confidence: (analysis.confidence * 100).toFixed(1),
          type: analysis.breakoutType,
        });
      }
    }

    return { symbol, alerts };
  } catch (error) {
    console.error(`Error for ${symbol}:`, error.message);
    return { symbol, alerts: [] };
  }
}

(async () => {
  console.log('🔄 CORRECT Full Backtest (with prior base/breakout detection)\n');

  const symbols = ['MU', 'SNDK', 'NVDA', 'AAPL', 'MSFT', 'AMD'];
  
  let totalAlerts = 0;
  for (const sym of symbols) {
    const result = await fullBacktestCorrect(sym);
    totalAlerts += result.alerts.length;
    
    if (result.alerts.length > 0) {
      console.log(`✓ ${sym}: ${result.alerts.length} alerts`);
      result.alerts.slice(0, 3).forEach(a => {
        console.log(`  • ${a.date}: $${a.price} @ ${a.confidence}% (${a.type})`);
      });
    }
  }

  console.log(`\n📊 Total alerts across ${symbols.length} symbols: ${totalAlerts}`);
  process.exit(0);
})();

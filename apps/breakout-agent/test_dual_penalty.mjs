import axios from 'axios';

function calculateBarsInRange(allBars) {
  if (allBars.length < 6) return { barsInRange: 0, consolidationRangePercent: 0, consolidationVolumePercent: 0 };

  const currentBar = allBars[allBars.length - 1];
  const prev5Bars = allBars.slice(-6, -1);

  if (prev5Bars.length < 3) return { barsInRange: 0, consolidationRangePercent: 0, consolidationVolumePercent: 0 };

  const avgVolume = allBars.slice(-20).reduce((sum, b) => sum + b.volume, 0) / 20;

  const consolidationHigh = Math.max(...prev5Bars.map((b) => b.high));
  const consolidationLow = Math.min(...prev5Bars.map((b) => b.low));
  const consolidationRangePercent = ((consolidationHigh - consolidationLow) / consolidationLow) * 100;

  const consolidationAvgVolume = prev5Bars.reduce((sum, b) => sum + b.volume, 0) / prev5Bars.length;
  const consolidationVolumePercent = (consolidationAvgVolume / avgVolume) * 100;

  const breaksAboveConsolidation = currentBar.close > consolidationHigh;
  if (!breaksAboveConsolidation) return { barsInRange: 0, consolidationRangePercent: 0, consolidationVolumePercent: 0 };

  const highVolume = currentBar.volume >= avgVolume * 1.2;
  if (!highVolume) return { barsInRange: 0, consolidationRangePercent: 0, consolidationVolumePercent: 0 };

  return {
    barsInRange: prev5Bars.length,
    consolidationRangePercent,
    consolidationVolumePercent
  };
}

function calculateConfidence(result) {
  if (result.barsInRange === 0) return 0.1;
  
  let confidence = 0.99;

  if (result.consolidationRangePercent > 5) {
    const rangePenalty = (result.consolidationRangePercent - 5) / 100;
    confidence -= rangePenalty;
  }

  if (result.consolidationVolumePercent > 100) {
    const volumePenalty = (result.consolidationVolumePercent - 100) / 100;
    confidence -= volumePenalty;
  }

  confidence = Math.max(0.8, confidence);
  return confidence;
}

async function testStock(symbol) {
  const res = await axios.get(
    `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}`,
    {
      params: { 
        apikey: process.env.FMP_API_KEY,
        limit: 250
      },
      timeout: 10000,
    }
  );

  const allBars = res.data.historical
    .reverse()
    .map((d) => ({
      date: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

  const result = calculateBarsInRange(allBars);
  const confidence = calculateConfidence(result);

  console.log(`\n========== ${symbol} (${allBars[allBars.length - 1].date}) ==========`);
  console.log(`barsInRange: ${result.barsInRange}`);
  console.log(`Consolidation range: ${result.consolidationRangePercent.toFixed(2)}% (penalty: ${Math.max(0, result.consolidationRangePercent - 5).toFixed(2)}%)`);
  console.log(`Consolidation volume: ${result.consolidationVolumePercent.toFixed(2)}% avg (penalty: ${Math.max(0, result.consolidationVolumePercent - 100).toFixed(2)}%)`);
  console.log(`Confidence: ${(confidence * 100).toFixed(1)}%`);
}

await testStock('STXE');
await testStock('ADEA');

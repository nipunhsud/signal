import axios from 'axios';

function calculateBarsInRange(allBars) {
  if (allBars.length < 6) return { barsInRange: 0, consolidationRangePercent: 0 };

  const currentBar = allBars[allBars.length - 1];
  const prev5Bars = allBars.slice(-6, -1);

  if (prev5Bars.length < 3) return { barsInRange: 0, consolidationRangePercent: 0 };

  const avgVolume = allBars.slice(-20).reduce((sum, b) => sum + b.volume, 0) / 20;

  const consolidationHigh = Math.max(...prev5Bars.map((b) => b.high));
  const consolidationLow = Math.min(...prev5Bars.map((b) => b.low));
  const consolidationRange = consolidationHigh - consolidationLow;
  const consolidationRangePercent = (consolidationRange / consolidationLow) * 100;

  const consolidationAvgVolume = prev5Bars.reduce((sum, b) => sum + b.volume, 0) / prev5Bars.length;
  if (consolidationAvgVolume > avgVolume * 0.8) return { barsInRange: 0, consolidationRangePercent: 0 };

  const breaksAboveConsolidation = currentBar.close > consolidationHigh;
  if (!breaksAboveConsolidation) return { barsInRange: 0, consolidationRangePercent: 0 };

  const highVolume = currentBar.volume >= avgVolume * 1.2;
  if (!highVolume) return { barsInRange: 0, consolidationRangePercent: 0 };

  return {
    barsInRange: prev5Bars.length,
    consolidationRangePercent
  };
}

function calculateConfidence(barsInRange, consolidationRangePercent) {
  if (barsInRange === 0) return 0.1; // No green cone
  
  let confidence = 0.99;
  if (consolidationRangePercent > 5) {
    const penalty = (consolidationRangePercent - 5) / 100;
    confidence = 0.99 - penalty;
    confidence = Math.max(0.8, confidence);
  }
  return confidence;
}

try {
  console.log('Fetching STXE data...');
  const stxeRes = await axios.get(
    `https://financialmodelingprep.com/api/v3/historical-price-full/STXE`,
    {
      params: { 
        apikey: process.env.FMP_API_KEY,
        limit: 250
      },
      timeout: 10000,
    }
  );

  const stxeBars = stxeRes.data.historical
    .reverse()
    .map((d) => ({
      date: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

  console.log('\n========== STXE (Expected: 99% - tight consolidation) ==========');
  const stxeResult = calculateBarsInRange(stxeBars);
  const stxeConf = calculateConfidence(stxeResult.barsInRange, stxeResult.consolidationRangePercent);
  console.log(`Consolidation range: ${stxeResult.consolidationRangePercent.toFixed(2)}%`);
  console.log(`barsInRange: ${stxeResult.barsInRange}`);
  console.log(`Confidence: ${(stxeConf * 100).toFixed(1)}%`);

  console.log('\nFetching ADEA data...');
  const adeaRes = await axios.get(
    `https://financialmodelingprep.com/api/v3/historical-price-full/ADEA`,
    {
      params: { 
        apikey: process.env.FMP_API_KEY,
        limit: 250
      },
      timeout: 10000,
    }
  );

  const adeaBars = adeaRes.data.historical
    .reverse()
    .map((d) => ({
      date: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

  // Test latest
  console.log('\n========== ADEA Latest (May 4 - should NOT be 99%) ==========');
  const adeaLatest = calculateBarsInRange(adeaBars);
  const adeaLatestConf = calculateConfidence(adeaLatest.barsInRange, adeaLatest.consolidationRangePercent);
  console.log(`Consolidation range: ${adeaLatest.consolidationRangePercent.toFixed(2)}%`);
  console.log(`barsInRange: ${adeaLatest.barsInRange}`);
  console.log(`Confidence: ${(adeaLatestConf * 100).toFixed(1)}%`);

  // Find March 9 and test
  const march9Idx = adeaBars.findIndex(b => b.date === '2026-03-09');
  if (march9Idx !== -1) {
    console.log('\n========== ADEA March 9 (wider consolidation - should be ~95%) ==========');
    const march9Data = adeaBars.slice(0, march9Idx + 1);
    const march9Result = calculateBarsInRange(march9Data);
    const march9Conf = calculateConfidence(march9Result.barsInRange, march9Result.consolidationRangePercent);
    console.log(`Consolidation range: ${march9Result.consolidationRangePercent.toFixed(2)}%`);
    console.log(`barsInRange: ${march9Result.barsInRange}`);
    console.log(`Confidence: ${(march9Conf * 100).toFixed(1)}%`);
  }

} catch (error) {
  console.error('Error:', error.message);
}

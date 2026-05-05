import axios from 'axios';

function calculateBarsInRange(allBars) {
  if (allBars.length < 6) return 0;

  const currentBar = allBars[allBars.length - 1];
  const prev5Bars = allBars.slice(-6, -1);

  if (prev5Bars.length < 3) return 0;

  const avgVolume = allBars.slice(-20).reduce((sum, b) => sum + b.volume, 0) / 20;

  const consolidationHigh = Math.max(...prev5Bars.map((b) => b.high));
  const consolidationLow = Math.min(...prev5Bars.map((b) => b.low));
  const consolidationRange = consolidationHigh - consolidationLow;
  const consolidationRangePercent = (consolidationRange / consolidationLow) * 100;

  console.log(`\n=== ${currentBar.date} ===`);
  console.log(`Close: $${currentBar.close.toFixed(2)} | Volume: ${currentBar.volume.toLocaleString()}`);
  console.log(`Prev 5 closes: ${prev5Bars.map(b => `$${b.close.toFixed(2)}`).join(' → ')}`);
  console.log(`Consolidation range: ${consolidationRangePercent.toFixed(2)}% (need < 3%)`);

  if (consolidationRangePercent > 3) {
    console.log(`❌ FAILED: Range too wide\n`);
    return 0;
  }

  const consolidationAvgVolume = prev5Bars.reduce((sum, b) => sum + b.volume, 0) / prev5Bars.length;
  console.log(`Consolidation avg vol: ${consolidationAvgVolume.toLocaleString()} (need < ${(avgVolume * 0.8).toLocaleString()})`);

  if (consolidationAvgVolume > avgVolume * 0.8) {
    console.log(`❌ FAILED: Volume too high\n`);
    return 0;
  }

  const breaksAbove = currentBar.close > consolidationHigh;
  console.log(`Breaks above $${consolidationHigh.toFixed(2)}? ${breaksAbove ? '✓' : '❌'}`);
  if (!breaksAbove) {
    console.log(`❌ FAILED: No breakout\n`);
    return 0;
  }

  const highVol = currentBar.volume >= avgVolume * 1.2;
  console.log(`High volume? ${currentBar.volume.toLocaleString()} >= ${(avgVolume * 1.2).toLocaleString()}? ${highVol ? '✓' : '❌'}`);
  if (!highVol) {
    console.log(`❌ FAILED: Low breakout volume\n`);
    return 0;
  }

  console.log(`✅ GREEN CONE DETECTED!\n`);
  return prev5Bars.length;
}

try {
  console.log('Fetching ADEA historical data...');
  const response = await axios.get(
    `https://financialmodelingprep.com/api/v3/historical-price-full/ADEA`,
    {
      params: { 
        apikey: process.env.FMP_API_KEY,
        limit: 250
      },
      timeout: 10000,
    }
  );

  const allBars = response.data.historical
    .reverse()
    .map((d) => ({
      date: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

  // Test March 9
  const march9Idx = allBars.findIndex(b => b.date === '2026-03-09');
  if (march9Idx !== -1) {
    console.log('\n========== MARCH 9 (Expected: GREEN CONE) ==========');
    const march9Data = allBars.slice(0, march9Idx + 1);
    const result = calculateBarsInRange(march9Data);
    console.log(`Result: barsInRange = ${result}`);
  } else {
    console.log('March 9 data not found');
  }

  // Test May 5
  const may5Idx = allBars.findIndex(b => b.date === '2026-05-05');
  if (may5Idx !== -1) {
    console.log('\n========== MAY 5 (Expected: NO GREEN CONE) ==========');
    const may5Data = allBars.slice(0, may5Idx + 1);
    const result = calculateBarsInRange(may5Data);
    console.log(`Result: barsInRange = ${result}`);
  } else {
    console.log('May 5 data not found');
  }

  console.log('\n========== LATEST 10 BARS ==========');
  allBars.slice(-10).forEach(b => {
    console.log(`${b.date}: $${b.close.toFixed(2)} (vol: ${b.volume.toLocaleString()})`);
  });
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

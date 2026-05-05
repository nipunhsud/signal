import axios from 'axios';

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

  const currentBar = allBars[allBars.length - 1];
  const prev5Bars = allBars.slice(-6, -1);

  console.log(`\n========== ${symbol} - Latest (${currentBar.date}) ==========`);
  console.log(`Current: $${currentBar.close.toFixed(2)}, vol: ${currentBar.volume.toLocaleString()}`);
  console.log(`Prev 5 closes: ${prev5Bars.map(b => `$${b.close.toFixed(2)}`).join(' → ')}`);

  const avgVolume = allBars.slice(-20).reduce((sum, b) => sum + b.volume, 0) / 20;
  console.log(`20-bar avg volume: ${avgVolume.toLocaleString()}`);

  const consolidationHigh = Math.max(...prev5Bars.map((b) => b.high));
  const consolidationLow = Math.min(...prev5Bars.map((b) => b.low));
  const rangePercent = ((consolidationHigh - consolidationLow) / consolidationLow) * 100;

  console.log(`Consolidation high: $${consolidationHigh.toFixed(2)}, low: $${consolidationLow.toFixed(2)}`);
  console.log(`Range: ${rangePercent.toFixed(2)}%`);

  const consolidationAvgVol = prev5Bars.reduce((sum, b) => sum + b.volume, 0) / prev5Bars.length;
  console.log(`Consolidation avg vol: ${consolidationAvgVol.toLocaleString()} (need < ${(avgVolume * 0.8).toLocaleString()})`);
  console.log(`  → ${consolidationAvgVol < avgVolume * 0.8 ? '✓ PASS' : '❌ FAIL'}`);

  const breaksAbove = currentBar.close > consolidationHigh;
  console.log(`Breaks above $${consolidationHigh.toFixed(2)}? ${currentBar.close.toFixed(2)} > ${consolidationHigh.toFixed(2)}`);
  console.log(`  → ${breaksAbove ? '✓ PASS' : '❌ FAIL'}`);

  const highVol = currentBar.volume >= avgVolume * 1.2;
  console.log(`High volume? ${currentBar.volume.toLocaleString()} >= ${(avgVolume * 1.2).toLocaleString()}`);
  console.log(`  → ${highVol ? '✓ PASS' : '❌ FAIL'}`);
}

await testStock('STXE');
await testStock('ADEA');

import 'dotenv/config';
import { fetchMarketData } from './src/tools/market-data.js';
import { analyzeBreakout, analyzeSetup } from './src/tools/breakout-logic.js';
import { getConfig } from './src/config.js';

const config = getConfig();

async function testSetup() {
  const testSymbols = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'QQQ', 'SPY', 'IWM'];
  
  for (const symbol of testSymbols) {
    try {
      const data = await fetchMarketData(symbol, config.dataSource, config.ibkrBaseUrl);
      const breakout = analyzeBreakout(data);
      const setup = analyzeSetup(data, breakout);
      
      console.log(`\n${symbol}:`);
      console.log(`  Type 1 (Breakout):`);
      console.log(`    barsInRange: ${breakout.barsInRange}, breakoutSignal: ${breakout.breakoutSignal}`);
      console.log(`  Type 2 (Setup):`);
      console.log(`    setupBarsInRange: ${data.setupBarsInRange}`);
      console.log(`    setupVolumePercent: ${data.setupConsolidationVolumePercent}`);
      console.log(`    maStackTurning: ${breakout.maStackTurning}`);
      console.log(`    Setup detected: ${setup.isSetup}`);
      if (setup.isSetup) {
        console.log(`    Type: ${setup.setupType}`);
        console.log(`    Distance from MA20: ${setup.distanceFromMA20.toFixed(2)}%`);
        console.log(`    Confidence: ${(setup.confidence * 100).toFixed(0)}%`);
      }
    } catch (error) {
      console.error(`Error testing ${symbol}:`, error);
    }
  }
}

testSetup();

import 'dotenv/config';
import cron from 'node-cron';
import { BreakoutAgent } from './agent.js';
import { getConfig } from './config.js';

const config = getConfig();
const agent = new BreakoutAgent();

async function scan() {
  console.log(`[${new Date().toISOString()}] Starting breakout scan...`);
  try {
    const results = await agent.analyzeMarkets(config.assets);
    console.log(`Found ${results.length} signals`);

    for (const result of results) {
      if (result.shouldAlert) {
        console.log(`✓ Alert: ${result.asset} - Confidence: ${result.confidence}`);
        await agent.sendAlert(result);
      }
    }
  } catch (error) {
    console.error('Scan failed:', error);
  }
}

// Run immediately on start
scan();

// Schedule recurring scans
const schedule = config.cronSchedule || '0 * * * *'; // hourly by default
cron.schedule(schedule, scan);

console.log(`Breakout agent running. Schedule: ${schedule}`);

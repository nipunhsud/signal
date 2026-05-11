import "dotenv/config";
import cron from "node-cron";
import { BreakoutAgent } from "./agent.js";
import { getConfig } from "./config.js";

const config = getConfig();
const agent = new BreakoutAgent();
const DYNAMIC_ASSETS = process.env.DYNAMIC_ASSETS === "true";
const IMMEDIATE_SCAN = process.env.IMMEDIATE_SCAN === "true";

async function scan() {
  console.log(`[${new Date().toISOString()}] Starting breakout scan...`);
  try {
    // Fetch assets dynamically from FMP or use static config
    let assets = config.assets;
    if (DYNAMIC_ASSETS) {
      try {
        assets = await agent.fetchAssetsFromFMP();
      } catch (error) {
        console.error(
          "[CRITICAL] Dynamic asset fetch failed, cannot proceed:",
          error,
        );
        return;
      }
    }

    const results = await agent.analyzeMarkets(assets);
    console.log(`Found ${results.length} signals`);

    for (const result of results) {
      if (result.shouldAlert) {
        console.log(
          `✓ Alert: ${result.asset} - Confidence: ${result.confidence}`,
        );
        await agent.sendAlert(result);
      }
    }
  } catch (error) {
    console.error("Scan failed:", error);
  }
}

// Run immediately on start if IMMEDIATE_SCAN=true
if (IMMEDIATE_SCAN) {
  scan();
}

// Schedule recurring scans
const schedule = config.cronSchedule || "0 * * * *"; // hourly by default
cron.schedule(schedule, scan);

console.log(`Breakout agent running. Schedule: ${schedule}`);
console.log(
  `Asset mode: ${DYNAMIC_ASSETS ? "Dynamic (FMP)" : "Static (file)"}`,
);
console.log(`Immediate scan: ${IMMEDIATE_SCAN ? "enabled" : "disabled"}`);

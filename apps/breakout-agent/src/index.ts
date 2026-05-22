import "dotenv/config";
import cron from "node-cron";
import { BreakoutAgent } from "./agent.js";
import { getConfig } from "./config.js";

const config = getConfig();
const agent = new BreakoutAgent();
const DYNAMIC_ASSETS = process.env.DYNAMIC_ASSETS === "true";
const IMMEDIATE_SCAN = process.env.IMMEDIATE_SCAN === "true";

async function scan(mode: "stocks" | "etfs" = "stocks") {
  console.log(`[${new Date().toISOString()}] Starting ${mode} breakout scan...`);
  try {
    // Fetch assets dynamically from FMP or use static config
    let assets = config.assets;
    if (DYNAMIC_ASSETS) {
      try {
        assets = await agent.fetchAssetsFromFMP(mode);
      } catch (error) {
        console.error(
          `[CRITICAL] Dynamic ${mode} asset fetch failed, cannot proceed:`,
          error,
        );
        return;
      }
    }

    const results = await agent.analyzeMarkets(assets, mode);
    console.log(`Found ${results.length} ${mode} signals`);

    for (const result of results) {
      if (result.shouldAlert) {
        console.log(
          `✓ Alert: ${result.asset} - Confidence: ${result.confidence}`,
        );
        await agent.sendAlert(result);
      }
    }
  } catch (error) {
    console.error(`${mode} scan failed:`, error);
  }
}

// Run immediately on start if IMMEDIATE_SCAN=true
if (IMMEDIATE_SCAN) {
  (async () => {
    try {
      await scan("stocks");
      await scan("etfs");
      console.log("[EXIT] Immediate scans complete, exiting process");
      process.exit(0);
    } catch (err) {
      console.error("[EXIT] Scans failed:", err);
      process.exit(1);
    }
  })();
} else {
  // Schedule recurring scans (both stocks and ETFs, run sequentially to respect FMP rate limit)
  const schedule = config.cronSchedule || "0 10-16 * * 1-5"; // 10am-4pm EDT weekdays (covers market hours 9:30am-4pm)
  const timezone = process.env.TZ || 'America/New_York'; // Default to ET

  // Schedule with explicit timezone enforcement (node-cron v3+)
  cron.schedule(schedule, async () => {
    try {
      await scan("stocks");
      await scan("etfs");
    } catch (err) {
      console.error("Scheduled scans failed:", err);
    }
  }, { timezone });
  console.log(`Breakout agent running. Schedule: ${schedule} (Timezone: ${timezone})`);

  console.log(
    `Asset mode: ${DYNAMIC_ASSETS ? "Dynamic (FMP)" : "Static (file)"}`,
  );
  console.log(`Immediate scan: ${IMMEDIATE_SCAN ? "enabled" : "disabled"}`);
  console.log(`Running stocks and ETF scans sequentially per schedule (respecting FMP 750rpm limit)`);
}

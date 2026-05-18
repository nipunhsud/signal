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

    const results = await agent.analyzeMarkets(assets);
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
  Promise.all([scan("stocks"), scan("etfs")]).then(() => {
    console.log("[EXIT] Immediate scans complete, exiting process");
    process.exit(0);
  }).catch((err) => {
    console.error("[EXIT] Scans failed:", err);
    process.exit(1);
  });
} else {
  // Schedule recurring scans (both stocks and ETFs)
  const schedule = config.cronSchedule || "0 10-15 * * *"; // 10am-3pm ET by default (cron runs at top of hour)
  const timezone = process.env.TZ || 'America/New_York'; // Default to ET

  // Use timezone option if available (node-cron v3+)
  try {
    cron.schedule(schedule, () => {
      Promise.all([scan("stocks"), scan("etfs")]).catch(err =>
        console.error("Scheduled scans failed:", err)
      );
    }, { scheduled: true });
    console.log(`Breakout agent running. Schedule: ${schedule} (Timezone: ${timezone})`);
  } catch (e) {
    // Fallback for older node-cron
    cron.schedule(schedule, () => {
      Promise.all([scan("stocks"), scan("etfs")]).catch(err =>
        console.error("Scheduled scans failed:", err)
      );
    });
    console.log(`Breakout agent running. Schedule: ${schedule}`);
  }

  console.log(
    `Asset mode: ${DYNAMIC_ASSETS ? "Dynamic (FMP)" : "Static (file)"}`,
  );
  console.log(`Immediate scan: ${IMMEDIATE_SCAN ? "enabled" : "disabled"}`);
  console.log(`Running both stocks and ETF scans per schedule`);
}

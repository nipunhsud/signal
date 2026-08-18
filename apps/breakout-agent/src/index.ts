import "dotenv/config";
import cron from "node-cron";
import { BreakoutAgent, marketStatus } from "./agent.js";
import { getConfig } from "./config.js";

const config = getConfig();
const agent = new BreakoutAgent();
const DYNAMIC_ASSETS = process.env.DYNAMIC_ASSETS === "true";
const IMMEDIATE_SCAN = process.env.IMMEDIATE_SCAN === "true";
const REGION = (process.env.REGION || "US") as "US" | "IN";
// India scans NSE stocks only (no NSE ETF universe yet). fetchAssetsFromFMP reads REGION itself.
const SCAN_MODES: ("stocks" | "etfs")[] = REGION === "IN" ? ["stocks"] : ["stocks", "etfs"];

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
      for (const m of SCAN_MODES) await scan(m);
      console.log("[EXIT] Immediate scans complete, exiting process");
      process.exit(0);
    } catch (err) {
      console.error("[EXIT] Scans failed:", err);
      process.exit(1);
    }
  })();
} else {
  // Schedule recurring scans (both stocks and ETFs, run sequentially to respect FMP rate limit).
  // CRON_SCHEDULE may hold multiple ';'-separated expressions (e.g. India runs two
  // fixed times: "30 9 * * 1-5;0 15 * * 1-5"). US has no ';' so it stays one schedule.
  const schedules = (config.cronSchedule || "*/15 9-15 * * 1-5")
    .split(";").map((s) => s.trim()).filter(Boolean);
  const timezone = process.env.TZ || 'America/New_York'; // Default to ET

  // Schedule with explicit timezone enforcement (node-cron v3+)
  for (const schedule of schedules) {
    cron.schedule(schedule, async () => {
      const mkt = marketStatus(new Date(), REGION);
      if (!mkt.open) {
        console.log(`⊘ Skip scan: Outside market hours (${mkt.label})`);
        return;
      }
      try {
        for (const m of SCAN_MODES) await scan(m);
      } catch (err) {
        console.error("Scheduled scans failed:", err);
      }
    }, { timezone });
  }
  console.log(`Breakout agent running. Schedule(s): ${schedules.join(" | ")} (Timezone: ${timezone})`);

  // X posting: three scheduled jobs, all on the shard-0 tier only (it reads the
  // shared DB, which holds every tier's signals) so we never fan out duplicate
  // posts. All off unless X_POST_ENABLED=true.
  const isXPoster =
    process.env.X_POST_ENABLED === "true" &&
    (process.env.SHARD_INDEX ?? "0") === "0";
  if (isXPoster) {
    const scheduleX = (name: string, cronExpr: string, fn: () => Promise<void>) => {
      cron.schedule(cronExpr, async () => {
        try {
          await fn();
        } catch (err) {
          console.error(`X ${name} failed:`, err);
        }
      }, { timezone });
      console.log(`X ${name} scheduled: ${cronExpr} (Timezone: ${timezone})`);
    };

    // 1) Signal teasers — noon & 4pm ET weekdays.
    scheduleX("teasers", process.env.X_TEASER_CRON || "0 12,16 * * 1-5", () => agent.postXSignalTeasers());
    // 2) Performance audit — 1pm ET on the 1st of each month.
    scheduleX("audit", process.env.X_AUDIT_CRON || "0 13 1 * *", () => agent.postXPerformanceAudit());
    // 3) Earnings breakdowns are posted manually via the dashboard admin button
    //    (POST /api/admin/tweet-earnings), not on a schedule.
    // 4) Earnings-calendar intercept — pre-open (8:35am) & after-close (4:15pm)
    //    ET weekdays, when a watchlist ticker's print has landed on FMP.
    scheduleX("earnings-cal", process.env.X_EARNINGS_CAL_CRON || "35 8,16 * * 1-5", () => agent.postXEarningsCalendar());
  }

  console.log(
    `Asset mode: ${DYNAMIC_ASSETS ? "Dynamic (FMP)" : "Static (file)"}`,
  );
  console.log(`Immediate scan: ${IMMEDIATE_SCAN ? "enabled" : "disabled"}`);
  console.log(`Running stocks and ETF scans sequentially every 15min during market hours (respecting FMP 750rpm limit)`);
}

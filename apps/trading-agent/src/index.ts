import "dotenv/config";
import cron from "node-cron";
import { TradingAgent } from "./agent.js";
import { getConfig } from "./config.js";

const config = getConfig();
const agent = new TradingAgent(config);

async function run() {
  console.log(`[${new Date().toISOString()}] Trading agent cycle starting...`);
  try {
    const results = await agent.executePendingSignals();
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    console.log(
      `[${new Date().toISOString()}] Done. Executed: ${successes.length}, Skipped/Failed: ${failures.length}`,
    );
    for (const r of successes) {
      console.log(
        `  ✓ ${r.asset} — order ${r.orderId}, qty=${r.quantity}, entry=$${r.entryPrice?.toFixed(2)}, stop=$${r.stopLossPrice?.toFixed(2)}`,
      );
    }
    for (const r of failures) {
      console.log(`  ✗ ${r.asset} — ${r.riskReason || r.error}`);
    }
  } catch (error) {
    console.error("[TradingAgent] Run failed:", error);
  }
}

async function main() {
  try {
    await agent.initialize();
  } catch (err) {
    console.error("[TradingAgent] Initialization failed:", err);
    process.exit(1);
  }

  await run();

  const schedule = config.cronSchedule;
  cron.schedule(schedule, run);

  console.log(`[TradingAgent] Running. Poll schedule: ${schedule}`);
}

main();

process.on("SIGINT", () => {
  agent.shutdown();
  process.exit(0);
});

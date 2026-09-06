import "dotenv/config";
import cron from "node-cron";
import { TradingAgent } from "./agent.js";
import { AlpacaBroker } from "./broker/alpaca.js";
import { getConfig, validateConfig } from "./config.js";
import { db } from "./db.js";

const config = getConfig();

if (!config.enabled) {
  console.log(
    "[trader] TRADING_ENABLED is not true — exiting without doing anything.",
  );
  process.exit(0);
}
const problems = validateConfig(config);
if (problems.length) {
  console.error("[trader] refusing to start:\n  - " + problems.join("\n  - "));
  process.exit(1);
}

const broker = new AlpacaBroker(config.alpaca);
const agent = new TradingAgent(broker, config);
let running = false;

async function cycle() {
  if (running) return; // a slow broker call must not overlap the next tick
  running = true;
  const t0 = Date.now();
  try {
    const s = await agent.runCycle();
    const parts = [
      s.halted ? `HALTED (${s.halted})` : null,
      s.entered.length ? `entered ${s.entered.join(",")}` : null,
      s.skipped.length ? `skipped ${s.skipped.length}` : null,
      s.reconciled ? `reconciled ${s.reconciled}` : null,
      s.reviewed ? `reviewed ${s.reviewed}` : null,
      s.exits ? `exits ${s.exits}` : null,
      s.errors.length ? `errors ${s.errors.length}` : null,
    ].filter(Boolean);
    console.log(
      `[trader] cycle done in ${Date.now() - t0}ms: ${parts.join(" · ") || "nothing to do"}`,
    );
    for (const e of s.errors) console.error(`[trader]   ! ${e}`);
  } catch (err) {
    console.error("[trader] cycle crashed:", err);
  } finally {
    running = false;
  }
}

async function main() {
  const account = await broker.getAccount();
  console.log(
    `[trader] ${config.mode.toUpperCase()} mode · profile ${config.profile} · ${config.alpaca.tradingBaseUrl} · account ${account.id} · equity $${account.equity.toFixed(2)} · ` +
      `risk ${config.riskPerTradePct}%/trade · cap ${config.maxPositionPct}% · max ${config.maxOpenPositions} open · ` +
      `daily-loss halt ${config.maxDailyLossPct}% · sell: 7% stop` +
      (config.maExit ? ` + close<MA${config.maExit}` : "") +
      (config.trailPct
        ? ` + ${config.trailPct}% trail on ${config.trailGrades.join("/")}`
        : "") +
      ` + ${config.holdDays}d backstop · grades ${config.allowedGrades.join("/")}`,
  );
  await cycle();
  cron.schedule(config.cronSchedule, cycle, { timezone: "America/New_York" });
  console.log(`[trader] scheduled ${config.cronSchedule} (New York)`);
}

main().catch((err) => {
  console.error("[trader] startup failed:", err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await db.$disconnect();
    process.exit(0);
  });
}

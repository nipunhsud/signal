import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function dashboard() {
  const breakouts = await db.breakoutSignal.findMany({
    orderBy: { confidence: "desc" },
    take: 10,
  });

  const setups = await db.signal.findMany({
    where: {
      agentName: "BreakoutAgent",
      signalType: { startsWith: "setup-" },
    },
    orderBy: { confidence: "desc" },
    take: 10,
  });

  const breakoutCount = await db.breakoutSignal.count();
  const setupCount = await db.signal.count({
    where: {
      agentName: "BreakoutAgent",
      signalType: { startsWith: "setup-" },
    },
  });

  console.log("\n" + "=".repeat(80));
  console.log("                    SIGNAL FORGE - DUAL SIGNAL DASHBOARD");
  console.log("=".repeat(80));

  console.log("\n🟢 TYPE 1: BREAKOUT SIGNALS (Actual Breakouts)");
  console.log("-".repeat(80));
  console.log(
    "ASSET | CONF | PINE | BARS | PRICE   | RESISTANCE | SUPPORT  | TIME",
  );
  console.log("-".repeat(80));
  breakouts.slice(0, 5).forEach((sig) => {
    const conf = (sig.confidence * 100).toFixed(0).padStart(3);
    const pine = sig.pineScriptGreen ? "✓" : " ";
    const bars = sig.barsInRange?.toString().padStart(2) || "0";
    const price = sig.currentPrice.toFixed(2).padStart(7);
    const res = sig.resistance.toFixed(2).padStart(10);
    const sup = sig.support.toFixed(2).padStart(8);
    const time = new Date(sig.createdAt).toLocaleTimeString().slice(0, 8);
    console.log(
      `${sig.asset.padEnd(5)} | ${conf}% | ${pine}  | ${bars}   | ${price} | ${res} | ${sup} | ${time}`,
    );
  });
  console.log(
    `\nTotal: ${breakoutCount} signals | High conf (≥90%): ${await db.breakoutSignal.count({ where: { confidence: { gte: 0.9 } } })} | Alerts: ${await db.breakoutSignal.count({ where: { shouldAlert: true } })}`,
  );

  console.log("\n\n🔵 TYPE 2: SETUP SIGNALS (Pre-Breakout Consolidations)");
  console.log("-".repeat(80));
  console.log(
    "ASSET | TYPE    | DIST  | MA20   | CONF  | CONSOLIDATION | TIME",
  );
  console.log("-".repeat(80));
  setups.forEach((sig) => {
    const meta = sig.metadata as any;
    const conf = (sig.confidence * 100).toFixed(0).padStart(3);
    const type = meta.setupType?.padEnd(6) || "unknown";
    const dist = meta.distanceFromMA20?.toFixed(1).padStart(4) || "   0";
    const ma20 = meta.ma20?.toFixed(2).padStart(6) || "     0";
    const range =
      meta.setupConsolidationRangePercent?.toFixed(1).padStart(3) || "  0";
    const vol =
      meta.setupConsolidationVolumePercent?.toFixed(0).padStart(2) || " 0";
    const time = new Date(sig.createdAt).toLocaleTimeString().slice(0, 8);
    console.log(
      `${sig.asset.padEnd(5)} | ${type} | ${dist}% | ${ma20} | ${conf}% | ${range}% / ${vol}% | ${time}`,
    );
  });
  console.log(
    `\nTotal: ${setupCount} signals | High conf (≥85%): ${await db.signal.count({ where: { agentName: "BreakoutAgent", signalType: { startsWith: "setup-" }, confidence: { gte: 0.85 } } })}`,
  );

  console.log("\n" + "=".repeat(80));
  console.log("Scan in progress... S&P 500 full suite running");
  console.log("=".repeat(80) + "\n");

  await db.$disconnect();
}

dashboard().catch(console.error);

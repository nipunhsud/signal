import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function dashboard() {
  // Alerts actually sent (alertSentAt is not null)
  const alerts = await db.breakoutSignal.findMany({
    where: { alertSentAt: { not: null } },
    orderBy: { alertSentAt: "desc" },
    take: 10,
  });

  // High-confidence signals (whether alerted or not)
  const breakouts = await db.breakoutSignal.findMany({
    where: { confidence: { gte: 0.8 } },
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
  const alertCount = await db.breakoutSignal.count({ where: { alertSentAt: { not: null } } });
  const setupCount = await db.signal.count({
    where: {
      agentName: "BreakoutAgent",
      signalType: { startsWith: "setup-" },
    },
  });

  console.log("\n" + "=".repeat(80));
  console.log("                    SIGNAL FORGE - DUAL SIGNAL DASHBOARD");
  console.log("=".repeat(80));

  console.log("\n🔴 ALERTS SENT (Email Notifications)");
  console.log("-".repeat(120));
  console.log(
    "ASSET  | TYPE   | CONF | BARS | PRICE    | RESISTANCE | SUPPORT   | SIGNAL DATE        | ALERT SENT",
  );
  console.log("-".repeat(120));
  alerts.slice(0, 5).forEach((sig) => {
    const type = (sig.breakoutType || "unknown").padEnd(6);
    const conf = (sig.confidence * 100).toFixed(0).padStart(3);
    const bars = (sig.barsInRange?.toString() || "0").padStart(4);
    const price = sig.currentPrice.toFixed(2).padStart(8);
    const res = sig.resistance.toFixed(2).padStart(10);
    const sup = sig.support.toFixed(2).padStart(9);
    const signalDate = sig.signalDate ? new Date(sig.signalDate).toLocaleDateString().padEnd(10) + " " + new Date(sig.signalDate).toLocaleTimeString().slice(0, 5) : "N/A".padEnd(15);
    const alertSent = sig.alertSentAt ? new Date(sig.alertSentAt).toLocaleDateString().padEnd(10) + " " + new Date(sig.alertSentAt).toLocaleTimeString().slice(0, 5) : "N/A";
    console.log(
      `${sig.asset.padEnd(6)} | ${type} | ${conf}% | ${bars} | ${price} | ${res} | ${sup} | ${signalDate} | ${alertSent}`,
    );
  });
  console.log(
    `\nAlerts Sent: ${alertCount} total`,
  );

  console.log("\n\n🟡 HIGH-CONFIDENCE SIGNALS (80%+ Tracked)");
  console.log("-".repeat(120));
  console.log(
    "ASSET  | TYPE   | CONF | BARS | PRICE    | RESISTANCE | SUPPORT   | SIGNAL DATE        | ALERT STATUS",
  );
  console.log("-".repeat(120));
  breakouts.slice(0, 5).forEach((sig) => {
    const type = (sig.breakoutType || "unknown").padEnd(6);
    const conf = (sig.confidence * 100).toFixed(0).padStart(3);
    const bars = (sig.barsInRange?.toString() || "0").padStart(4);
    const price = sig.currentPrice.toFixed(2).padStart(8);
    const res = sig.resistance.toFixed(2).padStart(10);
    const sup = sig.support.toFixed(2).padStart(9);
    const signalDate = sig.signalDate ? new Date(sig.signalDate).toLocaleDateString().padEnd(10) + " " + new Date(sig.signalDate).toLocaleTimeString().slice(0, 5) : "N/A".padEnd(15);
    const alertStatus = sig.alertSentAt ? "✓ Alerted" : "Tracked";
    console.log(
      `${sig.asset.padEnd(6)} | ${type} | ${conf}% | ${bars} | ${price} | ${res} | ${sup} | ${signalDate} | ${alertStatus}`,
    );
  });
  console.log(
    `\nTotal: ${breakoutCount} signals | High conf (≥80%): ${await db.breakoutSignal.count({ where: { confidence: { gte: 0.8 } } })} | Alerts: ${alertCount}`,
  );

  console.log("\n\n🔵 TYPE 2: SETUP SIGNALS (Pre-Breakout Consolidations)");
  console.log("-".repeat(90));
  console.log(
    "ASSET  | TYPE     | DIST   | MA20     | CONF | RANGE  | VOL  | LOGGED AT",
  );
  console.log("-".repeat(90));
  setups.forEach((sig) => {
    const meta = sig.metadata as any;
    const conf = (sig.confidence * 100).toFixed(0).padStart(3);
    const type = (meta.setupType || "unknown").padEnd(8);
    const dist = (meta.distanceFromMA20?.toFixed(1) || "0").padStart(6);
    const ma20 = (meta.ma20?.toFixed(2) || "0").padStart(8);
    const range = (meta.setupConsolidationRangePercent?.toFixed(1) || "0").padStart(5);
    const vol = (meta.setupConsolidationVolumePercent?.toFixed(0) || "0").padStart(3);
    const time = new Date(sig.createdAt).toLocaleDateString() + " " + new Date(sig.createdAt).toLocaleTimeString().slice(0, 5);
    console.log(
      `${sig.asset.padEnd(6)} | ${type} | ${dist}% | ${ma20} | ${conf}% | ${range}% | ${vol}% | ${time}`,
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

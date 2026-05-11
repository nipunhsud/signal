import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function viewSignals() {
  // View latest setup signals
  const setupSignals = await db.signal.findMany({
    where: {
      agentName: "BreakoutAgent",
      signalType: { startsWith: "setup-" },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log(
    "\n📊 LATEST SETUP SIGNALS (Type 2: Pre-Breakout Consolidations)\n",
  );
  console.log("ASSET | TYPE    | DIST  | BARS | CONF  | TIME");
  console.log("------|---------|-------|------|-------|----------");

  setupSignals.forEach((s) => {
    const meta = s.metadata as any;
    const conf = (s.confidence * 100).toFixed(0).padStart(3);
    const type = meta.setupType?.padEnd(6) || "unknown";
    const dist = meta.distanceFromMA20?.toFixed(1).padStart(4) || "   0";
    const bars = meta.barsInRange?.toString().padStart(2) || "0";
    const time = new Date(s.createdAt).toLocaleTimeString();
    console.log(
      `${s.asset.padEnd(5)} | ${type} | ${dist}% | ${bars}   | ${conf}% | ${time}`,
    );
  });

  console.log(`\n✓ Total setup signals: ${setupSignals.length}`);

  await db.$disconnect();
}

viewSignals().catch(console.error);

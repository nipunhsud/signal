import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function viewSetupSignals() {
  const signals = await db.signal.findMany({
    where: {
      agentName: 'BreakoutAgent',
      signalType: { startsWith: 'setup-' }
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  console.log(`\n📊 Setup Signals - Type 2 Pre-Breakout Consolidations (${signals.length} total)\n`);
  console.log('ASSET | TYPE    | DISTANCE | BARS | PRICE   | MA20   | CONF  | TIME');
  console.log('------|---------|----------|------|---------|--------|-------|----------');

  signals.forEach((s) => {
    const meta = s.metadata as any;
    const conf = (s.confidence * 100).toFixed(0).padStart(3);
    const type = meta.setupType?.padEnd(6) || 'unknown';
    const dist = meta.distanceFromMA20?.toFixed(1).padStart(4) || '   0';
    const bars = meta.barsInRange?.toString().padStart(2) || '0';
    const price = meta.currentPrice?.toFixed(2).padStart(7) || '      0';
    const ma20 = meta.ma20?.toFixed(2).padStart(6) || '     0';
    const time = new Date(s.createdAt).toLocaleTimeString();
    console.log(
      `${s.asset.padEnd(5)} | ${type} | ${dist}%   | ${bars}   | ${price} | ${ma20} | ${conf}% | ${time}`
    );
  });

  const highConf = signals.filter((s) => s.confidence > 0.85).length;
  console.log(`\n🎯 High confidence setups (>85%): ${highConf} / ${signals.length}\n`);

  await db.$disconnect();
}

viewSetupSignals().catch(console.error);

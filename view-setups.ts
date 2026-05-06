import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function viewSetups() {
  const setups = await db.signal.findMany({
    where: { agentName: 'BreakoutAgent', signalType: { startsWith: 'setup-' } },
    orderBy: { confidence: 'desc' },
  });

  console.log(`\n📊 ALL SETUP SIGNALS (${setups.length} total)\n`);
  console.log('ASSET | TYPE    | DIST % | MA20   | CONF% | BARS');
  console.log('------|---------|--------|--------|-------|-----');

  for (const sig of setups) {
    const m = sig.metadata as any;
    const type = m.setupType?.substring(0, 6).padEnd(7) || 'unknown';
    const dist = m.distanceFromMA20?.toFixed(1).padStart(5) || '    0';
    const ma20 = m.ma20?.toFixed(0).padStart(6) || '     0';
    const conf = (sig.confidence * 100).toFixed(0).padStart(4);
    const bars = m.barsInRange?.toString().padStart(4) || '   0';
    console.log(`${sig.asset.padEnd(5)} | ${type} | ${dist}  | ${ma20} | ${conf} | ${bars}`);
  }

  await db.$disconnect();
}

viewSetups();

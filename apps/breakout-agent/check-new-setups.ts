import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function check() {
  const setups = await db.signal.findMany({
    where: { agentName: 'BreakoutAgent', signalType: { startsWith: 'setup-' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  console.log(`Latest 5 setup signals:\n`);
  console.log('ASSET | TYPE    | DIST % | RANGE % | VOL % | CONF%');
  console.log('------|---------|--------|---------|-------|------');

  for (const sig of setups) {
    const m = sig.metadata as any;
    const type = m.setupType?.padEnd(7) || 'unknown';
    const dist = m.distanceFromMA20?.toFixed(1).padStart(5) || '    0';
    const range = m.setupConsolidationRangePercent?.toFixed(1).padStart(6) || '     0';
    const vol = m.setupConsolidationVolumePercent?.toFixed(0).padStart(4) || '   0';
    const conf = (sig.confidence * 100).toFixed(0).padStart(4);
    console.log(`${sig.asset.padEnd(5)} | ${type} | ${dist}% | ${range}% | ${vol}% | ${conf}%`);
  }

  await db.$disconnect();
}

check().catch(console.error);

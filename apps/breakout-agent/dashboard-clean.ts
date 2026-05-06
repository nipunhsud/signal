import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function dashboard() {
  const setups = await db.signal.findMany({
    where: { agentName: 'BreakoutAgent', signalType: { startsWith: 'setup-' } },
    orderBy: { confidence: 'desc' },
  });

  const breakouts = await db.breakoutSignal.findMany({
    orderBy: { confidence: 'desc' },
    take: 10,
  });

  console.log('\n' + '='.repeat(90));
  console.log('SIGNAL FORGE DASHBOARD - TYPE 1 (BREAKOUTS) + TYPE 2 (SETUPS)'.padStart(60));
  console.log('='.repeat(90));

  console.log('\n🟢 TYPE 1: BREAKOUT SIGNALS (Top 10 by confidence)');
  console.log('-'.repeat(90));
  console.log('ASSET | CONF  | PINE | PRICE    | RESISTANCE | SUPPORT');
  console.log('-'.repeat(90));
  
  for (const sig of breakouts.slice(0, 10)) {
    const conf = (sig.confidence * 100).toFixed(0).padStart(3);
    const pine = sig.pineScriptGreen ? '✓' : '✗';
    const price = sig.currentPrice.toFixed(2).padStart(8);
    const res = sig.resistance.toFixed(2).padStart(10);
    const sup = sig.support.toFixed(2).padStart(8);
    console.log(`${sig.asset.padEnd(5)} | ${conf}%  | ${pine}  | ${price} | ${res} | ${sup}`);
  }

  console.log('\n\n🔵 TYPE 2: SETUP SIGNALS - PRE-BREAKOUT CONSOLIDATIONS (${setups.length} total)');
  console.log('-'.repeat(90));
  console.log('ASSET | TYPE    | DISTANCE | MA20    | CONFIDENCE | CONSOLIDATION QUALITY');
  console.log('-'.repeat(90));
  
  for (const sig of setups) {
    const m = sig.metadata as any;
    const type = m.setupType.padEnd(7);
    const dist = m.distanceFromMA20?.toFixed(1).padStart(7) || '      0';
    const ma20 = m.ma20?.toFixed(0).padStart(6) || '     0';
    const conf = (sig.confidence * 100).toFixed(0).padStart(3);
    const range = m.setupConsolidationRangePercent?.toFixed(1).padStart(4) || '   0';
    const vol = m.setupConsolidationVolumePercent?.toFixed(0).padStart(2) || ' 0';
    const quality = `${range}% range / ${vol}% vol`;
    console.log(`${sig.asset.padEnd(5)} | ${type} | ${dist}% | ${ma20} | ${conf}%       | ${quality}`);
  }

  console.log('\n' + '='.repeat(90));
  console.log(`SUMMARY: ${breakouts.length} breakouts scanned | ${setups.length} setups detected | S&P 500 suite active`);
  console.log('='.repeat(90) + '\n');

  await db.$disconnect();
}

dashboard().catch(console.error);

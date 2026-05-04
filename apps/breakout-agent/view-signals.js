import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function viewSignals() {
  const signals = await db.breakoutSignal.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  console.log(`\n📊 Latest Breakout Signals (${signals.length} total)\n`);
  console.log('ASSET | CONF | SIGNAL | ALERT | PRICE  | RES    | SUP    | TIME');
  console.log('------|------|--------|-------|--------|--------|--------|----------');

  signals.forEach((s) => {
    const conf = (s.confidence * 100).toFixed(0).padStart(3);
    let signal = '';
    if (s.confidence > 0.85) {
      signal = '🟢 green';
    } else if (s.confidence > 0.75) {
      signal = '🟠 orange';
    } else {
      signal = '🟡 yellow';
    }
    const alert = s.shouldAlert ? '✓' : ' ';
    const time = new Date(s.createdAt).toLocaleTimeString();
    console.log(
      `${s.asset.padEnd(5)} | ${conf}% | ${signal.padEnd(7)} | ${alert}     | ${s.currentPrice.toFixed(2).padStart(6)} | ${s.resistance.toFixed(2).padStart(6)} | ${s.support.toFixed(2).padStart(6)} | ${time}`
    );
  });

  const alertCount = signals.filter((s) => s.shouldAlert).length;
  console.log(`\n⚠️  Alerts: ${alertCount} / ${signals.length}\n`);

  await db.$disconnect();
}

viewSignals().catch(console.error);

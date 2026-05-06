import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function checkSignals() {
  const breakoutCount = await db.breakoutSignal.count();
  const setupCount = await db.signal.count({
    where: {
      agentName: 'BreakoutAgent',
      signalType: { startsWith: 'setup-' }
    }
  });

  const highConfidenceBreakouts = await db.breakoutSignal.count({
    where: { confidence: { gte: 0.9 } }
  });

  const highConfidenceSetups = await db.signal.count({
    where: {
      agentName: 'BreakoutAgent',
      signalType: { startsWith: 'setup-' },
      confidence: { gte: 0.85 }
    }
  });

  console.log(`\n📊 Signal Summary`);
  console.log(`=================`);
  console.log(`Type 1 (Breakouts):        ${breakoutCount} total, ${highConfidenceBreakouts} high confidence (≥90%)`);
  console.log(`Type 2 (Setups):           ${setupCount} total, ${highConfidenceSetups} high confidence (≥85%)`);
  console.log(`\nScan in progress...`);

  await db.$disconnect();
}

checkSignals().catch(console.error);

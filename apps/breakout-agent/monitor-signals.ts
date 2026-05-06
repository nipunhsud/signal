import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function monitorSignals() {
  let lastBreakoutCount = 0;
  let lastSetupCount = 0;

  while (true) {
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

    if (breakoutCount > lastBreakoutCount || setupCount > lastSetupCount) {
      console.clear();
      console.log(`[${new Date().toLocaleTimeString()}] Signal Forge - Live Dashboard`);
      console.log(`${'='.repeat(70)}`);
      console.log(`Type 1 (Breakouts):        ${breakoutCount.toString().padStart(5)} total | ${highConfidenceBreakouts.toString().padStart(3)} high conf (≥90%)`);
      console.log(`Type 2 (Setups):           ${setupCount.toString().padStart(5)} total | ${highConfidenceSetups.toString().padStart(3)} high conf (≥85%)`);
      console.log(`${'='.repeat(70)}`);

      lastBreakoutCount = breakoutCount;
      lastSetupCount = setupCount;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

monitorSignals().catch(console.error);

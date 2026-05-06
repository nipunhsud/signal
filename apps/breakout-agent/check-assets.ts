import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function check() {
  const assets = ['MU', 'IRM', 'INTC'];

  for (const asset of assets) {
    const breakout = await db.breakoutSignal.findFirst({
      where: { asset },
      orderBy: { createdAt: 'desc' }
    });

    const setup = await db.signal.findFirst({
      where: { 
        asset,
        agentName: 'BreakoutAgent',
        signalType: { startsWith: 'setup-' }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`\n${asset}:`);
    if (breakout) {
      console.log(`  Breakout: ${(breakout.confidence * 100).toFixed(0)}% | Pine: ${breakout.pineScriptGreen ? '✓' : '✗'}`);
    } else {
      console.log(`  Breakout: None`);
    }
    
    if (setup) {
      const m = setup.metadata as any;
      console.log(`  Setup: ${(setup.confidence * 100).toFixed(0)}% | Type: ${m.setupType} | Dist: ${m.distanceFromMA20?.toFixed(1)}%`);
    } else {
      console.log(`  Setup: None`);
    }
  }

  await db.$disconnect();
}

check();

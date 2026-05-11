import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const db = new PrismaClient();
const apiKey = process.env.FMP_API_KEY;

if (!apiKey) {
  console.error('FMP_API_KEY not set');
  process.exit(1);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function backfillSectors() {
  try {
    // Get all unique assets with NULL sector
    const signals = await db.breakoutSignal.findMany({
      where: { sector: null },
      select: { asset: true },
      distinct: ['asset'],
      take: 100,
    });

    console.log(`Found ${signals.length} assets with missing sector data`);

    for (const { asset } of signals) {
      try {
        const response = await axios.get(
          `https://financialmodelingprep.com/api/v3/profile/${asset}`,
          { params: { apikey: apiKey }, timeout: 10000 }
        );

        if (response.data && response.data.length > 0) {
          const { sector, industry } = response.data[0];
          await db.breakoutSignal.updateMany({
            where: { asset },
            data: { sector, industry },
          });
          console.log(`✓ ${asset}: ${sector || 'N/A'}${industry ? ' / ' + industry : ''}`);
        }

        // Rate limit
        await sleep(100);
      } catch (error) {
        console.error(`✗ ${asset}:`, error.message);
        await sleep(500);
      }
    }

    console.log('Backfill complete!');
  } catch (error) {
    console.error('Backfill failed:', error);
  } finally {
    await db.$disconnect();
  }
}

backfillSectors();

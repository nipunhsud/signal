import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const apiKey = process.env.FMP_API_KEY;

const etfSectorMap = {
  SOX: { sector: "Semiconductors", industry: "Semiconductor Equipment & Materials" },
  XSD: { sector: "Semiconductors", industry: "Semiconductor Equipment & Materials" },
  SOXL: { sector: "Semiconductors", industry: "Semiconductor Equipment & Materials" },
  QQQ: { sector: "Technology", industry: "Software & Tech Services" },
  XLK: { sector: "Technology", industry: "Software & Tech Services" },
  XSLV: { sector: "Technology", industry: "Software & Tech Services" },
  CIBR: { sector: "Technology", industry: "Software & Tech Services" },
  SOXX: { sector: "Semiconductors", industry: "Semiconductor Equipment & Materials" },
  XLV: { sector: "Healthcare", industry: "Healthcare Services" },
  XLY: { sector: "Consumer Cyclical", industry: "Consumer Services" },
  XLE: { sector: "Energy", industry: "Oil & Gas" },
  XLI: { sector: "Industrials", industry: "Industrial Services" },
  XLF: { sector: "Financial Services", industry: "Financial" },
  XLRE: { sector: "Real Estate", industry: "Real Estate" },
  XLP: { sector: "Consumer Defensive", industry: "Consumer Staples" },
  XLU: { sector: "Utilities", industry: "Utilities" },
  SPY: { sector: "Broad Market", industry: "S&P 500" },
  IVV: { sector: "Broad Market", industry: "S&P 500" },
  VOO: { sector: "Broad Market", industry: "S&P 500" },
  VTI: { sector: "Broad Market", industry: "US Total Market" },
  SPTM: { sector: "Broad Market", industry: "US Total Market" },
  THRO: { sector: "Broad Market", industry: "US Total Market" },
  DXJ: { sector: "International Equity", industry: "Japan" },
  HEWJ: { sector: "International Equity", industry: "Japan" },
  EWJ: { sector: "International Equity", industry: "Japan" },
  JPXN: { sector: "International Equity", industry: "Japan" },
  SCHJ: { sector: "International Equity", industry: "Japan" },
  PSUS: { sector: "Alternative Strategies", industry: "Holding Company" },
  FPAC: { sector: "Alternative Strategies", industry: "SPAC" },
};

async function fetchSectorFromFMP(symbol) {
  try {
    const response = await axios.get(
      `https://financialmodelingprep.com/api/v3/profile/${symbol}`,
      {
        params: { apikey: apiKey },
        timeout: 5000,
      }
    );
    if (response.data && response.data.length > 0) {
      const sector = response.data[0].sector || null;
      const industry = response.data[0].industry || null;
      return { sector, industry };
    }
  } catch (err) {
    console.warn(`  ⚠️ FMP fetch failed for ${symbol}: ${err.message}`);
  }
  return null;
}

async function backfillBreakoutSignals() {
  console.log('🔄 Backfilling BreakoutSignal unclassified records...');

  const unclassified = await db.breakoutSignal.findMany({
    where: { sector: 'Unclassified' },
    distinct: ['asset'],
    select: { asset: true },
  });

  console.log(`Found ${unclassified.length} unique assets with Unclassified sector`);

  let updated = 0;
  let stayed = 0;

  for (const { asset } of unclassified) {
    // Check ETF map first
    if (etfSectorMap[asset]) {
      const { sector, industry } = etfSectorMap[asset];
      await db.breakoutSignal.updateMany({
        where: { asset, sector: 'Unclassified' },
        data: { sector, industry },
      });
      console.log(`✓ ${asset}: ${sector} (from ETF map)`);
      updated++;
    } else {
      // Fetch from FMP
      const data = await fetchSectorFromFMP(asset);
      if (data && (data.sector || data.industry)) {
        const sector = data.sector || 'Unclassified';
        const industry = data.industry || 'Unclassified';
        await db.breakoutSignal.updateMany({
          where: { asset, sector: 'Unclassified' },
          data: { sector, industry },
        });
        console.log(`✓ ${asset}: ${sector}`);
        updated++;
      } else {
        stayed++;
      }
    }

    // Rate limit: FMP allows 250 requests/min
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`\n✅ Backfilled ${updated} assets. ${stayed} remained Unclassified (FMP has no data).`);
}

async function backfillSetupSignals() {
  console.log('\n🔄 Backfilling Signal (setup) unclassified records...');

  const unclassified = await db.signal.findMany({
    where: {
      signalType: { startsWith: 'setup-' },
      metadata: {
        path: ['sector'],
        equals: 'Unclassified',
      },
    },
    distinct: ['asset'],
    select: { asset: true },
  });

  console.log(`Found ${unclassified.length} unique assets with Unclassified sector in setup signals`);

  let updated = 0;
  let stayed = 0;

  for (const { asset } of unclassified) {
    // Check ETF map first
    if (etfSectorMap[asset]) {
      const { sector, industry } = etfSectorMap[asset];
      await db.signal.updateMany({
        where: { asset, signalType: { startsWith: 'setup-' } },
        data: {
          metadata: {
            sector,
            industry,
          },
        },
      });
      console.log(`✓ ${asset}: ${sector} (from ETF map)`);
      updated++;
    } else {
      // Fetch from FMP
      const data = await fetchSectorFromFMP(asset);
      if (data && (data.sector || data.industry)) {
        const sector = data.sector || 'Unclassified';
        const industry = data.industry || 'Unclassified';
        await db.signal.updateMany({
          where: { asset, signalType: { startsWith: 'setup-' } },
          data: {
            metadata: {
              sector,
              industry,
            },
          },
        });
        console.log(`✓ ${asset}: ${sector}`);
        updated++;
      } else {
        stayed++;
      }
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`\n✅ Backfilled ${updated} setup signal assets. ${stayed} remained Unclassified.`);
}

async function main() {
  try {
    await backfillBreakoutSignals();
    await backfillSetupSignals();
    console.log('\n✅ All backfills complete!');
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await db.$disconnect();
  }
}

main();

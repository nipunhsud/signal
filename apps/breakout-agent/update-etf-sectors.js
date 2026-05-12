import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const etfSectorMap = {
  'SOX': { sector: 'Semiconductors', industry: 'Semiconductor Equipment & Materials' },
  'XSD': { sector: 'Semiconductors', industry: 'Semiconductor Equipment & Materials' },
  'SOXL': { sector: 'Semiconductors', industry: 'Semiconductor Equipment & Materials' },
  'QQQ': { sector: 'Technology', industry: 'Software & Tech Services' },
  'XLK': { sector: 'Technology', industry: 'Software & Tech Services' },
  'XSLV': { sector: 'Technology', industry: 'Software & Tech Services' },
  'CIBR': { sector: 'Technology', industry: 'Software & Tech Services' },
  'SOXX': { sector: 'Semiconductors', industry: 'Semiconductor Equipment & Materials' },
  'XLV': { sector: 'Healthcare', industry: 'Healthcare Services' },
  'XLY': { sector: 'Consumer Cyclical', industry: 'Consumer Services' },
  'XLE': { sector: 'Energy', industry: 'Oil & Gas' },
  'XLI': { sector: 'Industrials', industry: 'Industrial Services' },
  'XLF': { sector: 'Financial Services', industry: 'Financial' },
  'XLRE': { sector: 'Real Estate', industry: 'Real Estate' },
  'XLP': { sector: 'Consumer Defensive', industry: 'Consumer Staples' },
  'XLU': { sector: 'Utilities', industry: 'Utilities' },
  'SPY': { sector: 'Broad Market', industry: 'S&P 500' },
  'IVV': { sector: 'Broad Market', industry: 'S&P 500' },
  'VOO': { sector: 'Broad Market', industry: 'S&P 500' },
  'VTI': { sector: 'Broad Market', industry: 'US Total Market' },
  'SPTM': { sector: 'Broad Market', industry: 'US Total Market' },
  'THRO': { sector: 'Broad Market', industry: 'US Total Market' },
  'ESGU': { sector: 'Broad Market', industry: 'US Total Market' },
};

async function updateETFSectors() {
  for (const [symbol, sectorInfo] of Object.entries(etfSectorMap)) {
    const result = await db.breakoutSignal.updateMany({
      where: { asset: symbol, assetType: 'etf' },
      data: { sector: sectorInfo.sector, industry: sectorInfo.industry },
    });
    if (result.count > 0) {
      console.log(`✓ Updated ${symbol} (${result.count} records): ${sectorInfo.sector}`);
    }
  }

  // Also update setup signals
  const setupMap = {
    'QQQ': { sector: 'Technology', industry: 'Software & Tech Services' },
    'SOX': { sector: 'Semiconductors', industry: 'Semiconductor Equipment & Materials' },
  };

  for (const [symbol, sectorInfo] of Object.entries(setupMap)) {
    await db.signal.updateMany({
      where: { asset: symbol, agentName: 'BreakoutAgent' },
      data: {
        metadata: {
          sector: sectorInfo.sector,
          industry: sectorInfo.industry,
        },
      },
    });
  }
  
  await db.$disconnect();
  console.log('Done!');
}

updateETFSectors().catch(console.error);

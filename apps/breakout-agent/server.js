// Simple API endpoint to fetch signals
// Run with: node server.js
import 'dotenv/config';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const app = express();
const db = new PrismaClient();

app.use(express.json());
app.use(express.static('public'));

app.get('/api/signals', async (req, res) => {
  console.log('[/api/signals] Handler called with query:', req.query);
  const assetTypeFilter = req.query.type || 'all'; // 'stocks', 'etfs', or 'all'

  try {
    // Get removed assets
    const removedAssets = await db.removedAsset.findMany({
      select: { asset: true }
    });
    const removedAssetSet = new Set(removedAssets.map(r => r.asset));

    // Type 1: Breakout signals (+ Type 3 Extensions)
    const breakoutSignals = await db.$queryRaw`
      WITH first_green AS (
        SELECT DISTINCT ON (asset)
          asset,
          "createdAt" AS "firstGreenAt",
          resistance AS "entryResistance"
        FROM "BreakoutSignal"
        WHERE "pineScriptGreen" = true
        ORDER BY asset, "createdAt" ASC
      ),
      ranked AS (
        SELECT
          bs.asset,
          bs.confidence,
          bs."currentPrice",
          bs.resistance,
          bs.support,
          bs."shouldAlert",
          bs."agentDecision",
          bs."createdAt",
          bs."pineScriptGreen",
          bs."bullishCandle",
          bs."barsInRange",
          bs."assetType",
          bs."expenseRatio",
          bs."etfCategory",
          bs.sector,
          bs.industry,
          fg."firstGreenAt",
          fg."entryResistance",
          ROW_NUMBER() OVER (PARTITION BY bs.asset ORDER BY bs."createdAt" DESC) as rn
        FROM "BreakoutSignal" bs
        LEFT JOIN first_green fg ON fg.asset = bs.asset
        WHERE bs.confidence >= 0.80
          AND bs."createdAt" > NOW() - INTERVAL '24 hours'
      )
      SELECT
        asset,
        confidence,
        "currentPrice",
        resistance,
        support,
        "shouldAlert",
        "agentDecision",
        "createdAt",
        "pineScriptGreen",
        "bullishCandle",
        "barsInRange",
        "assetType",
        "expenseRatio",
        "etfCategory",
        sector,
        industry,
        "firstGreenAt",
        "entryResistance"
      FROM ranked
      WHERE rn = 1
        AND confidence >= 0.80
      ORDER BY confidence DESC, "createdAt" DESC
    `;

    // Type 2: Setup signals
    const setupSignals = await db.signal.findMany({
      where: {
        agentName: 'BreakoutAgent',
        signalType: { startsWith: 'setup-' },
        confidence: { gte: 0.80 },
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      },
      orderBy: { confidence: 'desc' },
    });

    // Format Type 1 & Type 3 response
    const formatBreakout = (s) => {
      const firstGreenAt = s.firstGreenAt ? new Date(s.firstGreenAt) : null;
      const hoursSinceFirstGreen = firstGreenAt ? (Date.now() - firstGreenAt.getTime()) / (1000 * 60 * 60) : null;
      const daysSinceBreakout = hoursSinceFirstGreen !== null ? hoursSinceFirstGreen / 24 : null;
      const entryResistance = s.entryResistance ? parseFloat(s.entryResistance) : null;

      // Type 3: Green cone conditions met, but first green was before today (yellow dot re-test/extension)
      // Type 1: Green cone conditions met for first time today (true green cone breakout)
      const isExtension = (
        s.pineScriptGreen &&
        firstGreenAt !== null &&
        daysSinceBreakout !== null &&
        daysSinceBreakout > 0
      );

      const signalType = isExtension ? 'extension' : (s.pineScriptGreen ? 'breakout' : 'breakout');
      const pctGainFromEntry = (isExtension && entryResistance > 0)
        ? Math.round(((s.currentPrice - entryResistance) / entryResistance) * 1000) / 10
        : null;

      // Extensions show true confidence with distance penalty
      let displayConfidence = Math.round(s.confidence * 100);
      if (isExtension && pctGainFromEntry !== null) {
        // Penalize based on extension distance from entry:
        // 0-2%: no penalty (ideal re-entry zone)
        // 2-5%: -1% per 1% gain
        // 5%+: -1.5% per 1% gain
        let extensionPenalty = 0;
        if (pctGainFromEntry > 2) {
          if (pctGainFromEntry <= 5) {
            extensionPenalty = pctGainFromEntry - 2; // -1% per 1%
          } else {
            extensionPenalty = (5 - 2) + (pctGainFromEntry - 5) * 1.5; // steeper for >5%
          }
        }
        displayConfidence = Math.max(50, displayConfidence - Math.round(extensionPenalty)); // Floor at 50%
      }

      const assetTypeLabel = s.assetType === 'etf' ? '📊 ETF' : '📈 STOCK';
      const etfNote = s.assetType === 'etf' && s.expenseRatio ? ` (${s.expenseRatio}% expense)` : '';

      return {
        asset: s.asset,
        assetType: s.assetType || 'stock',
        assetTypeLabel,
        expenseRatio: s.expenseRatio,
        etfCategory: s.etfCategory,
        sector: s.sector || 'Unknown',
        industry: s.industry || 'Unknown',
        confidence: displayConfidence,
        currentPrice: s.currentPrice,
        resistance: s.resistance,
        support: s.support,
        shouldAlert: s.shouldAlert,
        agentDecision: s.agentDecision || '',
        createdAt: s.createdAt,
        pineScriptGreen: s.pineScriptGreen || false,
        bullishCandle: s.bullishCandle || false,
        barsInRange: s.barsInRange || 0,
        signalType,
        displayType: signalType === 'extension' ? 'extension' : s.pineScriptGreen ? 'green' : s.confidence >= 90 ? 'orange' : 'yellow',
        firstGreenAt: firstGreenAt ? firstGreenAt.toISOString() : null,
        entryResistance,
        daysSinceBreakout: daysSinceBreakout !== null ? Math.round(daysSinceBreakout * 10) / 10 : null,
        pctGainFromEntry,
        displayAsset: `${s.asset} ${assetTypeLabel}${etfNote}`,
      };
    };

    // Format Type 2 response
    const formatSetup = (s) => {
      const meta = s.metadata || {};
      const assetType = meta.assetType || 'stock';
      const assetTypeLabel = assetType === 'etf' ? '📊 ETF' : '📈 STOCK';
      const etfNote = assetType === 'etf' && meta.expenseRatio ? ` (${meta.expenseRatio}% expense)` : '';

      return {
        asset: s.asset,
        assetType,
        assetTypeLabel,
        expenseRatio: meta.expenseRatio,
        etfCategory: meta.etfCategory,
        confidence: Math.round(s.confidence * 100),
        currentPrice: meta.currentPrice || 0,
        ma20: meta.ma20 || 0,
        distanceFromMA20: meta.distanceFromMA20 || 0,
        createdAt: s.createdAt,
        signalType: 'setup',
        setupType: meta.setupType || 'unknown',
        consolidationRange: meta.setupConsolidationRangePercent || 0,
        consolidationVolume: meta.setupConsolidationVolumePercent || 0,
        displayType: s.confidence >= 0.95 ? 'green' : s.confidence >= 0.85 ? 'orange' : 'yellow',
        agentDecision: meta.agentDecision || s.agentDecision || '',
        sector: meta.sector || 'Unknown',
        industry: meta.industry || 'Unknown',
        displayAsset: `${s.asset} ${assetTypeLabel}${etfNote}`,
      };
    };

    // Apply asset type filter
    const filterByAssetType = (signal) => {
      if (assetTypeFilter === 'stocks') return signal.assetType === 'stock';
      if (assetTypeFilter === 'etfs') return signal.assetType === 'etf';
      return true; // 'all'
    };

    // Combine and format, filtering out removed assets and applying type filter
    const formattedBreakouts = breakoutSignals
      .filter(s => !removedAssetSet.has(s.asset) && filterByAssetType(s))
      .map(formatBreakout);
    const formattedSetups = setupSignals
      .filter(s => !removedAssetSet.has(s.asset) && filterByAssetType(s))
      .map(formatSetup);

    const allSignals = [...formattedBreakouts, ...formattedSetups];
    const sorted = allSignals.sort((a, b) => b.confidence - a.confidence);

    const highConfidence = sorted.filter(s => s.confidence >= 95);
    const mediumConfidence = sorted.filter(s => s.confidence >= 80 && s.confidence < 95);

    const breakoutCount = formattedBreakouts.filter(s => s.signalType === 'breakout').length;
    const extensionCount = formattedBreakouts.filter(s => s.signalType === 'extension').length;
    const setupCount = formattedSetups.length;

    res.json({
      highConfidence,
      mediumConfidence,
      stats: {
        highConfidenceCount: highConfidence.length,
        mediumConfidenceCount: mediumConfidence.length,
        total: sorted.length,
        breakoutCount,
        extensionCount,
        setupCount,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    // Import the agent dynamically
    const { BreakoutAgent } = await import('./dist/agent.js');
    const { getConfig } = await import('./dist/config.js');

    const config = getConfig();
    const agent = new BreakoutAgent();

    res.json({ status: 'scanning', assetsCount: config.assets.length, message: 'Scan started in background' });

    // Run scan in background (don't wait for it)
    // Run both stocks and ETFs scans sequentially to respect FMP 750rpm limit
    (async () => {
      try {
        const stocksResults = await agent.analyzeMarkets(config.assets, "stocks");
        const etfsResults = await agent.analyzeMarkets(config.assets, "etfs");
        const allResults = [...stocksResults, ...etfsResults];
        const alerts = allResults.filter((r) => r.shouldAlert).length;
        console.log(`✅ On-demand scan completed: ${allResults.length} signals, ${alerts} alerts`);
      } catch (error) {
        console.error('❌ On-demand scan failed:', error);
      }
    })();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/shortlist', async (req, res) => {
  try {
    const items = await db.shortlist.findMany({
      orderBy: { addedAt: 'desc' },
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shortlist', async (req, res) => {
  try {
    const { asset } = req.body;
    const item = await db.shortlist.upsert({
      where: { asset },
      update: { updatedAt: new Date() },
      create: { asset },
    });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/shortlist/:asset', async (req, res) => {
  try {
    const { asset } = req.params;
    await db.shortlist.delete({ where: { asset } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/removed-assets', async (req, res) => {
  try {
    const { asset } = req.body;
    const item = await db.removedAsset.upsert({
      where: { asset },
      update: { removedAt: new Date() },
      create: { asset, id: randomUUID() },
    });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/removed-assets/:asset', async (req, res) => {
  try {
    const { asset } = req.params;
    await db.removedAsset.delete({ where: { asset } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/candles/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const apiKey = process.env.FMP_API_KEY;
    const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&limit=500&apikey=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    // Response is direct array, not wrapped in {historical: [...]}
    const historicalData = Array.isArray(data) ? data : (data.historical || []);
    const bars = historicalData
      .reverse()
      .map(b => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    res.json(bars);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`📊 Dashboard running on http://localhost:${PORT}`);
  console.log(`   • API: http://localhost:${PORT}/api/signals`);
  console.log(`   • Trigger scan: POST http://localhost:${PORT}/api/scan`);
});

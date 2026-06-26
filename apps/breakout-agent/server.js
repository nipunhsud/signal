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
          bs."breakoutType",
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
        "breakoutType",
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

      // Use actual breakoutType from database: Type1 (fresh) vs Type3 (extension)
      const isType1 = s.breakoutType === 'Type1';
      const isType3 = s.breakoutType === 'Type3';
      const isExtension = isType3;

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
        stopLoss: s.support > 0 ? Math.round(s.support * 0.98 * 100) / 100 : null, // 2% below support
        riskReward: entryResistance > 0 && s.support > 0 ? Math.round(((s.currentPrice - s.support) / (entryResistance - s.support)) * 100) / 100 : null,
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
      // For raw DB signals, assetType is in metadata; for formatted signals, it's a direct property
      const assetType = signal.assetType || signal.metadata?.assetType;
      if (assetTypeFilter === 'stocks') return assetType === 'stock';
      if (assetTypeFilter === 'etfs') return assetType === 'etf';
      return true; // 'all'
    };

    // Combine and format, filtering out removed assets and applying type filter
    console.log(`[DEBUG] assetTypeFilter="${assetTypeFilter}", breakoutSignals=${breakoutSignals.length}, setupSignals=${setupSignals.length}`);
    const formattedBreakouts = breakoutSignals
      .filter(s => !removedAssetSet.has(s.asset) && filterByAssetType(s))
      .map(formatBreakout);
    const formattedSetups = setupSignals
      .filter(s => {
        const passes = !removedAssetSet.has(s.asset) && filterByAssetType(s);
        if (!passes && s.asset === 'ALKS') console.log(`[DEBUG] ALKS filtered out: removed=${removedAssetSet.has(s.asset)}, filterByAssetType=${filterByAssetType(s)}, assetType=${s.metadata?.assetType}`);
        return passes;
      })
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

app.get('/api/transcript/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const analysis = await db.transcriptAnalysis.findFirst({
      where: { asset: symbol.toUpperCase() },
      orderBy: [{ year: 'desc' }, { quarter: 'desc' }],
    });
    if (!analysis) return res.json(null);
    res.json({
      asset: analysis.asset,
      quarter: analysis.quarter,
      year: analysis.year,
      tone: analysis.tone,
      toneScore: analysis.toneScore,
      guidanceDirection: analysis.guidanceDirection,
      riskFlags: analysis.riskFlags,
      highlights: analysis.highlights,
      summary: analysis.summary,
      modelUsed: analysis.modelUsed,
      createdAt: analysis.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/candles/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'FMP_API_KEY not set' });
    }

    const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&limit=500&apikey=${apiKey}`;
    console.log(`[/api/candles] Fetching: ${symbol}`);

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[/api/candles] FMP error for ${symbol}: ${response.status}`);
      return res.status(response.status).json({ error: `FMP API error: ${response.status}` });
    }

    const data = await response.json();

    // Handle different FMP response formats
    let historicalData = [];
    if (Array.isArray(data)) {
      historicalData = data;
    } else if (data.historical && Array.isArray(data.historical)) {
      historicalData = data.historical;
    } else if (data.results && Array.isArray(data.results)) {
      historicalData = data.results;
    }

    if (!historicalData.length) {
      console.warn(`[/api/candles] No data for ${symbol}`);
      return res.json([]);
    }

    const bars = historicalData
      .reverse()
      .map(b => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }))
      .filter(b => b.time && b.open && b.high && b.low && b.close); // Filter out incomplete bars

    console.log(`[/api/candles] Success: ${symbol} = ${bars.length} bars`);
    res.json(bars);
  } catch (error) {
    console.error(`[/api/candles] Error for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`📊 Dashboard running on http://localhost:${PORT}`);
  console.log(`   • API: http://localhost:${PORT}/api/signals`);
  console.log(`   • Trigger scan: POST http://localhost:${PORT}/api/scan`);
});

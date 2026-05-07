// Simple API endpoint to fetch signals
// Run with: node server.js
import 'dotenv/config';
import express from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const db = new PrismaClient();

app.use(express.json());
app.use(express.static('public'));

app.get('/api/signals', async (req, res) => {
  console.log('[/api/signals] Handler called');
  try {
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

      // Extensions get lowered confidence (re-tests, not fresh breakouts)
      let displayConfidence = Math.round(s.confidence * 100);
      if (isExtension) {
        displayConfidence = Math.min(displayConfidence, 85); // Cap extensions at 85%
      }

      return {
        asset: s.asset,
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
      };
    };

    // Format Type 2 response
    const formatSetup = (s) => {
      const meta = s.metadata || {};
      return {
        asset: s.asset,
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
      };
    };

    // Combine and format
    const formattedBreakouts = breakoutSignals.map(formatBreakout);
    const formattedSetups = setupSignals.map(formatSetup);

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
    agent.analyzeMarkets(config.assets)
      .then((results) => {
        const alerts = results.filter((r) => r.shouldAlert).length;
        console.log(`✅ On-demand scan completed: ${results.length} signals, ${alerts} alerts`);
      })
      .catch((error) => {
        console.error('❌ On-demand scan failed:', error);
      });
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

app.get('/api/candles/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const apiKey = process.env.FMP_API_KEY;
    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(symbol)}?limit=500&apikey=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    const bars = (data.historical || [])
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

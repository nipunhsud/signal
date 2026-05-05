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
    // Get latest signal per asset, last 24h, deduped and filtered
    const allSignals = await db.$queryRaw`
      WITH ranked AS (
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
          ROW_NUMBER() OVER (PARTITION BY asset ORDER BY "createdAt" DESC) as rn
        FROM "BreakoutSignal"
        WHERE "shouldAlert" = true
          AND confidence >= 0.80
          AND "createdAt" > NOW() - INTERVAL '24 hours'
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
        "barsInRange"
      FROM ranked
      WHERE rn = 1
        AND confidence >= 0.80
      ORDER BY confidence DESC, "createdAt" DESC
    `;

    // Format response
    const formatSignal = (s) => ({
      asset: s.asset,
      confidence: Math.round(s.confidence * 100),
      currentPrice: s.currentPrice,
      resistance: s.resistance,
      support: s.support,
      shouldAlert: s.shouldAlert,
      agentDecision: s.agentDecision || '',
      createdAt: s.createdAt,
      pineScriptGreen: s.pineScriptGreen || false,
      bullishCandle: s.bullishCandle || false,
      barsInRange: s.barsInRange || 0,
      signalType: s.pineScriptGreen ? 'green' : s.confidence >= 0.90 ? 'orange' : 'yellow',
    });

    // Separate by confidence tier - prioritize Pine Script Green signals
    const formatted = allSignals.map(formatSignal);
    console.log('Formatted signal sample:', JSON.stringify(formatted[0], null, 2));
    const highConfidence = formatted.filter(s => s.pineScriptGreen || s.confidence >= 99); // Green cone = 99%
    const mediumConfidence = formatted.filter(s => !s.pineScriptGreen && s.confidence >= 80 && s.confidence < 99);

    res.json({
      highConfidence,
      mediumConfidence,
      stats: {
        highConfidenceCount: highConfidence.length,
        mediumConfidenceCount: mediumConfidence.length,
        total: highConfidence.length + mediumConfidence.length,
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
    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(symbol)}?limit=250&apikey=${apiKey}`;
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

// Minimal stand-in for server.js: serves the dashboard SPA for every client
// route and canned JSON for the API, so the navigation tests run without a
// database, Clerk or market data. Not used in production.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

const sig = (asset, signalType, confidence, extra = {}) => ({
  id: asset, asset, assetType: 'stock', signalType, confidence,
  currentPrice: 123.45, resistance: 120, support: 110, sector: 'Technology',
  createdAt: new Date().toISOString(), ...extra,
});

export const SIGNALS = {
  highConfidence: [
    sig('NVDA', 'breakout', 97, { baseGrade: 'A', basePivot: 120 }),
    sig('AAPL', 'breakout', 90, { baseGrade: 'A+', basePivot: 120 }),
    sig('MSFT', 'breakout', 88, { baseGrade: 'S', basePivot: 120 }),
    sig('TSLA', 'breakout', 95, { baseGrade: 'X', basePivot: 120 }),
    sig('AMD', 'setup', 91),
  ],
  mediumConfidence: [],
  tracking: [],
  stats: {},
};

export function startStub(port = 0) {
  const app = express();
  app.get('/api/signals', (q, r) => r.json(SIGNALS));
  app.get('/api/shortlist-lists', (q, r) => r.json([{ id: 'l1', name: 'Default' }]));
  app.get('/api/shortlist', (q, r) => r.json([{ asset: 'NVDA' }, { asset: 'TSLA' }]));
  app.get('/api/winners', (q, r) => r.json({ winners: [{ asset: 'NVDA', tier: 'A' }, { asset: 'AAPL', tier: 'A' }, { asset: 'MSFT', tier: 'B' }] }));
  app.get('/api/beat-raise', (q, r) => r.json({ stocks: [] }));
  app.get('/api/unusual-volume', (q, r) => r.json({ stocks: [], date: '2026-09-04' }));
  app.get('/api/sector-strength', (q, r) => r.json({ sectors: [] }));
  app.get('/api/backtest', (q, r) => r.json({ summary: { totalSignals: 0 }, recent: [] }));
  app.get('/api/market-health', (q, r) => r.json({}));
  app.get('/api/admin/status', (q, r) => r.json({ isAdmin: false }));
  app.get('/api/*', (q, r) => r.json({}));
  const spa = (q, r) => r.sendFile(path.join(pub, 'index.html'));
  app.get(['/dashboard', '/dashboard/*', '/in/dashboard', '/in/dashboard/*', /^\/\$.*/, '/s/:s'], spa);
  app.use(express.static(pub));
  return new Promise((resolve) => {
    const srv = app.listen(port, () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

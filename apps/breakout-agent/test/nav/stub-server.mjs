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
    sig('NVDA', 'breakout', 97, { baseGrade: 'A', basePivot: 120, baseBars: 20, volumeTag: 'confirmed', activity: { score: 5, acc: 5, dist: 0, bigUp: 2, udv: 1.47, obv: 0.12 }, sectorRank: 5, sectorCount: 11, sector: 'Technology' }),  // +2.9% over pivot → confirmed; stored rank is stale on purpose
    sig('AAPL', 'breakout', 90, { baseGrade: 'A+', basePivot: 120, baseBars: 25, volumeTag: 'power', alertedAt: '2026-09-08T14:05:00Z' }),    // +2.9% → power, emailed
    sig('MSFT', 'breakout', 88, { baseGrade: 'S', basePivot: 120, baseBars: 80, currentPrice: 118 }),       // under pivot → forming
    sig('TSLA', 'breakout', 95, { baseGrade: 'X', basePivot: 120 }),
    sig('SWKS', 'breakout', 90, { basePivot: 84.79, baseDepthPct: 34.6, baseBars: 15, currentPrice: 74.02, entryPrice: 70.75, shelf: { kind: 'cheat', label: 'Cheat', posPct: 52, baseLow: 55.45, basePivot: 84.79, level: 70.75, pctBelowPivot: 12.7 } }), // shelf breakout inside a forming, ungraded base
    sig('AMD', 'setup', 91),
    sig('DEEP', 'breakout', 95, { basePivot: 100, baseDepthPct: 28, baseBars: 56, currentPrice: 103, entryPrice: 100, deepBase: true, volumeTag: 'power', sector: 'Energy', sectorRank: 1, sectorCount: 11 }), // the deep-base kind
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
  app.get('/api/sector-strength', (q, r) => r.json({ universe: 4200, asOf: new Date().toISOString(), leadingCount: 4, sectors: [
    { rank: 1, sector: 'Energy', stocks: 40, medianRsScore: 0.3, median1wPct: 1.2, median1mPct: 4, median3mPct: 9, leaders: 12, leadersPct: 30, topAssets: ['XOM'], rank4w: 8 },
    { rank: 2, sector: 'Health Care', stocks: 60, medianRsScore: 0.2, median1wPct: 0.9, median1mPct: 3, median3mPct: 7, leaders: 14, leadersPct: 23, topAssets: ['KNSA'], rank4w: 6 },
    { rank: 3, sector: 'Technology', stocks: 90, medianRsScore: 0.15, median1wPct: 0.6, median1mPct: 2, median3mPct: 6, leaders: 20, leadersPct: 22, topAssets: ['NVDA'], rank4w: 3 },
  ] }));
  app.get('/api/backtest', (q, r) => r.json({ summary: { totalSignals: 0 }, recent: [] }));
  app.get('/api/market-health', (q, r) => r.json({}));
  app.get('/api/admin/status', (q, r) => r.json({ isAdmin: false }));
  app.get('/api/admin/fmp-usage', (q, r) => r.json({ last30MB: 812.4, meteredSince: '2026-09-18', dailyBars: 4727902, days: [
    { date: '2026-09-19', totalMB: 410.2, calls: 12034, byKind: { 'eod-delta': { mb: 6.1, calls: 11800, maxRows: 3 }, 'eod-seed': { mb: 404.1, calls: 234, maxRows: 262 } },
      byContainer: { 'agent-tier-1': { mb: 82, calls: 2400, byKind: { 'eod-delta': { mb: 1.2, calls: 2360, maxRows: 3 }, 'eod-seed': { mb: 80.8, calls: 40, maxRows: 262 } } } } },
    { date: '2026-09-18', totalMB: 402.2, calls: 11890, byKind: { 'eod-delta': { mb: 6, calls: 11700, maxRows: 3 } }, byContainer: {} },
  ] }));
  // Two years of bars so the chart, base X-ray and profile have something to chew on.
  const bars = []; let px = 8; const d0 = new Date('2024-09-09');
  for (let i = 0; i < 500; i++) { const d = new Date(d0); d.setDate(d0.getDate() + Math.floor(i * 7 / 5)); px = Math.max(1, px * (1 + (Math.sin(i / 9) * 0.01 - 0.002)));
    bars.push({ time: d.toISOString().slice(0, 10), open: px * 0.99, high: px * 1.02, low: px * 0.97, close: px, volume: 20e6 }); }
  app.get('/api/candles/:s', (q, r) => r.json(bars));
  app.get('/api/bases/:s', (q, r) => r.json({ symbol: q.params.s, asOf: bars.at(-1).time, bases: [] }));
  app.get('/api/profile/:s', (q, r) => r.json({
    symbol: q.params.s, asOf: bars.at(-1).time,
    price: { close: 3.07, changePct: -2.54, volume: 25.93e6, avgVolume20: 30e6, volumeRatio: 0.86 },
    returns: { w1: -4.1, m1: -12.3, m3: -31.5 },
    range52: { high: 5.64, low: 3.01, highDate: '2026-05-29', pctFromHigh: -45.6, pctAboveLow: 2.0 },
    mas: { ma20: 3.35, ma50: 3.7, ma200: 4.4, above20: false, above50: false, above200: false, stack: false },
    rs: { rating: 8, score: -0.3, sector: 'Real Estate', updatedAt: new Date().toISOString() },
    base: { status: 'forming', weeks: 7.2, depthPct: 34.3, pivot: 4.2, low: 3.01, start: '2026-07-20', end: bars.at(-1).time, count: 8 },
    lastSignal: null, liquidityOk: true,
  }));
  // The alert ledger and per-ticker history, as the receipts page and drawer read them.
  const episode = { firstSeen: '2026-09-08T14:00:00Z', lastSeen: '2026-09-11T20:00:00Z', scans: 4, types: ['Type1', 'Type3'], grade: 'A+', basePivot: 120, baseWeeks: 5, baseDepthPct: 12,
    entry: 120, fail: 111.6, lastPrice: 123.45, high: 125, low: 119, pct: 2.9, maxPct: 4.2, status: 'past', alertedAt: '2026-09-08T14:05:00Z', xPostedAt: null };
  app.get('/api/history/:s', (q, r) => r.json({ asset: q.params.s, episodes: q.params.s === 'AAPL' ? [episode] : [], rows: 4 }));
  app.get('/api/alerts', (q, r) => r.json({ weekEnding: q.query.w || '2026-09-12', alerts: [{ asset: 'AAPL', alertedAt: '2026-09-08T14:05:00Z', grade: 'A+', baseWeeks: 5, pivot: 120, fail: 111.6, current: 123.45, pct: 2.9, cappedPct: 2.9, status: 'past' }],
    summary: { count: 1, past: 1, fell: 0, below: 0, avgCappedPct: 2.9 }, text: ['Last week the screen produced 1 breakout. 1 is still past the pivot and 0 fell through the fail level.\nAverage +2.9%, equal weight, exits at the fail level.', ''] }));
  // The chat over the pool: page, pool, and a canned streamed answer.
  app.get('/chat', (q, r) => r.sendFile(path.join(pub, 'chat.html')));
  app.get('/api/chat/pool', (q, r) => r.json({ days: 14, region: 'us', alerts: [
    { asset: 'AAPL', alertedAt: '2026-09-08T14:05:00Z', grade: 'A+', kind: 'pivot', baseWeeks: 5, pivot: 120, fail: 111.6, current: 123.45, pct: 2.9, cappedPct: 2.9, status: 'past' },
    { asset: 'SWKS', alertedAt: '2026-09-10T20:05:00Z', grade: 'A', kind: 'cheat', baseWeeks: 3, pivot: 70.75, fail: 65.8, current: 69.1, pct: -2.3, cappedPct: -2.3, status: 'below' },
  ], summary: { count: 2, past: 1, fell: 0, below: 1, avgCappedPct: 0.3 } }));
  app.post('/api/chat', express.json(), (q, r) => {
    // An expired session: 401 until the widget refreshes and retries.
    const last = (q.body?.messages || []).at(-1)?.content || '';
    if (last.includes('expire-me') && !q.get('x-auth-retry')) return r.status(401).json({ error: 'sign in required' });
    r.setHeader('Content-Type', 'text/event-stream');
    const send = (e, d) => r.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
    send('tool', { name: 'get_recent_alerts', input: { days: 14 } });
    send('text', { delta: 'AAPL closed 2.9% past its pivot from a grade A+ base, 5 weeks long. ' });
    send('text', { delta: 'SWKS sits 2.3% under its shelf.\n\n| Ticker | Grade | vs pivot |\n|---|---|---|\n| AAPL | A+ | +2.9% |\n| SWKS | A | -2.3% |' });
    send('done', {}); r.end();
  });
  app.get('/api/*', (q, r) => r.json({}));
  const spa = (q, r) => r.sendFile(path.join(pub, 'index.html'));
  app.get(['/dashboard', '/dashboard/*', '/in/dashboard', '/in/dashboard/*', /^\/\$.*/, '/s/:s'], spa);
  app.get('/pulse', (q, r) => r.sendFile(path.join(pub, 'pulse.html'))); // the receipts page, as server.js serves it
  app.use(express.static(pub));
  return new Promise((resolve) => {
    const srv = app.listen(port, () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

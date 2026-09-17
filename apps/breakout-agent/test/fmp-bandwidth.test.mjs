// FMP historical-price bandwidth: every EOD call is bounded and metered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deltaParams, windowFrom, recordFmp, getFmpUsage, fmpUsageLine } from '../dist/tools/market-data.js';

test('a delta asks for a closed window: from AND to, never from alone', () => {
  assert.deepEqual(deltaParams('2026-09-16', '2026-09-17'), { from: '2026-09-16', to: '2026-09-17' });
  const src = readFileSync(new URL('../src/tools/market-data.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fetchFmpEodRange\([^)]*\{ from: [^}]*\}\s*\)/, 'no from-only EOD request');
  assert.match(src, /\{ from: stored\[0\]\.date, to: today \}/, 'the repair refetch is bounded too');
  const store = src.slice(src.indexOf('async function fetchFmpEodRange'), src.indexOf('// Emergency Yahoo-only mode'));
  assert.doesNotMatch(store, /limit:/, 'FMP ignores limit — every bar-store request uses a date window');
  assert.match(src, /windowFrom\(today, SEED_CALENDAR_DAYS\)/);
});

test('date windows are calendar days ending today', () => {
  assert.deepEqual(windowFrom('2026-09-17', 380), { from: '2025-09-02', to: '2026-09-17' });
});

test('the meter counts calls, bytes and the largest response per kind', () => {
  recordFmp('eod-delta', 512, 2);
  recordFmp('eod-delta', 640, 3);
  recordFmp('eod-seed', 40000, 250);
  const u = getFmpUsage();
  assert.equal(u['eod-delta'].calls, 2);
  assert.equal(u['eod-delta'].bytes, 1152);
  assert.equal(u['eod-delta'].maxRows, 3);
  assert.equal(u['eod-seed'].rows, 250);
  assert.match(fmpUsageLine(u), /eod-delta 2 calls 0\.00 MB \(max 3 rows\)/);
});

test('the dashboard serves charts from the bar store before touching FMP', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const candles = server.slice(server.indexOf('async function getDailyCandles'), server.indexOf("app.get('/api/candles/:symbol'"));
  assert.ok(candles.indexOf('loadDbCandles') < candles.indexOf('fetchFmpCandles'), 'store before FMP in getDailyCandles');
  const closes = server.slice(server.indexOf('async function getHistoricalCloses'), server.indexOf('// Sparklines:'));
  assert.ok(closes.indexOf('loadDbCandles') < closes.indexOf('meteredFmpJson'), 'store before FMP in getHistoricalCloses');
  assert.doesNotMatch(server.replace(/meteredFmpJson\([^\n]*/g, ''), /historical-price-eod\/full/, 'every dashboard history call goes through the meter');
  for (const line of server.split('\n').filter((l) => l.includes('historical-price-eod'))) {
    assert.doesNotMatch(line, /&limit=/, 'no limit on a history URL (FMP ignores it and returns everything)');
    assert.match(line, /from=\$\{w\.from\}&to=\$\{w\.to\}/, 'every history URL names its window');
  }
});

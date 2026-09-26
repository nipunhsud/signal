// Liquidity in dollars, not shares.
//
// A share count decides membership by price. 100,000 shares admitted LFT at
// $1.82 — $194k of turnover a day, where a $25k position is 6% of a session —
// and rejected AutoZone at $3,493 and NVR at $8,500, which trade $330M and
// $187M a day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeBreakout } from '../dist/tools/breakout-logic.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// A clean graded breakout at whatever price and volume we hand it.
const at = (price, avgVolume) => {
  const pivot = price * 0.99;
  return analyzeBreakout({
    asset: 'X', assetType: 'stock',
    open: price * 0.985, close: price, high: price * 1.005, low: price * 0.98,
    volume: avgVolume * 2, avgVolume,
    ma20: price * 0.96, ma50: price * 0.94, ma150: price * 0.89, ma200: price * 0.85, ma200Prev: price * 0.845,
    low52w: price * 0.5, highs: Array(20).fill(pivot), lows: Array(20).fill(price * 0.9),
    high52w: pivot, barsInRange: 6, priorBaseDays: 30, priorBaseRangePercent: 12,
    consolidationRangePercent: 4, consolidationVolumePercent: 70,
    gradedBase: { pivot, pivotDate: 'p', bars: 30, depthPct: 12, sky: true, status: 'breakout', breakoutDate: 'b', brokeOutToday: true },
  });
};
const tradable = (price, avgVolume) => at(price, avgVolume).breakoutType !== 'unknown';

test('NVR at $8,500 on 20k shares is $170M a day and belongs on the screen', () => {
  assert.equal(tradable(8500, 20_000), true);
  assert.equal(tradable(3493, 95_000), true, 'AutoZone, $332M a day');
});

test('LFT at $1.82 on 107k shares is $195k a day and does not', () => {
  assert.equal(tradable(1.82, 107_000), false);
  assert.equal(tradable(1.50, 271_000), false, 'the median name the old rule kept: $407k a day');
});

test('the floor is turnover, so price and share count only matter together', () => {
  // Same dollars, opposite share counts — both sides of $750k a day.
  assert.equal(tradable(75, 10_000), true, '$750k exactly');
  assert.equal(tradable(0.75, 1_000_000), true, 'same dollars, a hundred times the shares');
  assert.equal(tradable(74, 10_000), false, 'just under, at a high price');
  assert.equal(tradable(0.74, 1_000_000), false, 'just under, at a low price');
});

test('no share-count floor survives anywhere', () => {
  const logic = src('../src/tools/breakout-logic.ts');
  assert.doesNotMatch(logic, /MIN_AVG_VOLUME/, 'the old constant is gone');
  assert.match(logic, /const MIN_DAILY_TURNOVER = 750_000;/);
  assert.match(logic, /avgVolume \* close >= MIN_DAILY_TURNOVER/);

  const agent = src('../src/agent.ts');
  assert.doesNotMatch(agent, /MIN_VOLUME/, 'and so is the universe one');
  assert.match(agent, /AVG\(volume \* close\)/, 'the universe query measures turnover');
  assert.match(agent, /const MIN_DOLLAR_VOL = parseInt\(process\.env\.MIN_DOLLAR_VOL \|\| "750000"\);/);
});

test('the number is tunable without a deploy, and ETFs keep their own', () => {
  const agent = src('../src/agent.ts');
  assert.match(agent, /process\.env\.MIN_DOLLAR_VOL/);
  assert.match(agent, /process\.env\.MIN_ETF_DOLLAR_VOL/);
  assert.match(agent, /mode === "etfs" \? MIN_ETF_DOLLAR_VOL : MIN_DOLLAR_VOL/);
});

// Is market cap enough on its own? No, and the reason is that market cap
// belongs to the issuer, not to the security.
//
// Above $300M cap, only 7.2% of breakouts turn over under $750k a day — and
// 43% of those names say "notes", "debenture", "preferred" or "series" in
// their listing, while 71% trade between $20 and $27, clustered on the $25 par
// of a baby bond. Southern Company notes, Duke Energy debentures, Algonquin
// subordinated notes: each inherits a $16-20B market cap from its parent while
// turning over a few hundred thousand dollars.
//
// Their statistics flatter them — 12% touch a fail level against 41% for the
// pool — because they barely move. That is an instrument, not an edge. The
// turnover floor is the only thing keeping fixed income off an equity screen,
// so it stays even though the cap floor already removes the small companies.
test('the turnover floor is what keeps baby bonds off an equity screen', () => {
  // A Southern Company note: $25 par, $556k a day, parent cap $20B.
  assert.equal(tradable(22.23, 25_000), false, 'SOJC-like, $556k a day');
  // A Duke debenture on the same shape.
  assert.equal(tradable(23.08, 30_000), false, 'DUKB-like, $692k a day');
  // The cap floor cannot see these: the cap it reads is the parent's.
  // Only turnover separates them from the operating company.
  assert.equal(tradable(23.08, 200_000), true, 'the same price with real turnover is a real stock');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakoutLead } from '../x-lead.js';

const money = (v) => (v != null ? '$' + Number(v).toFixed(2) : null);
const lead = (sig) => {
  const pct = sig.entryPrice > 0 && sig.currentPrice > 0 ? ((sig.currentPrice - sig.entryPrice) / sig.entryPrice) * 100 : null;
  return breakoutLead(sig.asset || 'ABC', sig, { money, pivot: money(sig.entryPrice ?? sig.basePivot), pct, isExt: sig.breakoutType === 'Type3' });
};

test('a fresh close above the pivot says so', () => {
  assert.equal(lead({ breakoutType: 'Type1', entryPrice: 100, basePivot: 100, currentPrice: 101 }), '$ABC closed above its pivot, $100.00.');
});

test('a shelf inside an unresolved base is not called a pivot', () => {
  assert.match(lead({ breakoutType: 'Type1', entryPrice: 59.31, basePivot: 62.47, baseDepthPct: 25, currentPrice: 59.7 }), /^\$ABC closed above a shelf, \$59\.31, \d+% of the way up a base that has not resolved\.$/);
});

test('an extension close to the pivot reads as a return to it; further out it reads as holding', () => {
  assert.equal(lead({ breakoutType: 'Type3', entryPrice: 100, currentPrice: 101 }), '$ABC came back to its pivot, $100.00, and the base still holds.');
  assert.equal(lead({ breakoutType: 'Type3', entryPrice: 100, currentPrice: 108 }), '$ABC is holding past its pivot, $100.00, now +8.0% past it.');
});

test('a row back under its pivot never claims a close above it', () => {
  assert.equal(lead({ breakoutType: 'Type1', entryPrice: 100, basePivot: 100, currentPrice: 98 }), '$ABC cleared its pivot, $100.00, and is back 2.0% under it.');
});

test('catalyst days, gap retests and pre-breakout handles each say what happened', () => {
  assert.equal(lead({ breakoutType: 'EP', volumeRatio: 4.24, currentPrice: 39.8 }), '$ABC repriced today on 4.2x average volume, closing at $39.80.');
  assert.equal(lead({ breakoutType: 'GR', entryPrice: 50, currentPrice: 51 }), "$ABC held its gap and closed above the prior day's high, $50.00.");
  assert.equal(lead({ breakoutType: 'Setup', distanceToPivotPct: 2.14, basePivot: 30 }), '$ABC is building a handle 2.1% under its pivot, $30.00.');
});

test('Indian tickers drop the exchange suffix', () => {
  assert.equal(lead({ asset: 'TCS.NS', breakoutType: 'Type1', entryPrice: 100, basePivot: 100, currentPrice: 101 }), '$TCS closed above its pivot, $100.00.');
});

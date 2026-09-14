// Cheat / low cheat / handle: where a shelf breakout sits inside a forming base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShelf } from '../shelf.js';

test('SWKS 2026-09-02 was a mid-base cheat, 13% under the base pivot', () => {
  const s = classifyShelf({ level: 70.75, basePivot: 84.79, baseDepthPct: 34.6, price: 74.02 });
  assert.equal(s.kind, 'cheat');
  assert.equal(s.posPct, 52);
  assert.equal(s.baseLow, 55.45);
  assert.equal(s.pctBelowPivot, 12.7);
});

test('thirds of the base: low cheat, cheat, handle', () => {
  const base = { basePivot: 100, baseDepthPct: 30, price: 80 }; // low 70
  assert.equal(classifyShelf({ ...base, level: 78 }).kind, 'low-cheat');
  assert.equal(classifyShelf({ ...base, level: 85 }).kind, 'cheat');
  assert.equal(classifyShelf({ ...base, level: 95, price: 96 }).kind, 'handle');
});

test('a close at or above the base pivot is a pivot breakout, not a shelf', () => {
  assert.equal(classifyShelf({ level: 95, basePivot: 100, baseDepthPct: 30, price: 100 }), null);
  assert.equal(classifyShelf({ level: 95, basePivot: 100, baseDepthPct: 30, price: 104 }), null);
});

test('a level outside the base, or a row without base metrics, is not classified', () => {
  assert.equal(classifyShelf({ level: 60, basePivot: 100, baseDepthPct: 30, price: 80 }), null, 'under the base low');
  assert.equal(classifyShelf({ level: 85, basePivot: null, baseDepthPct: 30, price: 80 }), null);
  assert.equal(classifyShelf({ level: 85, basePivot: 100, baseDepthPct: 0, price: 80 }), null);
});

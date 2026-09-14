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

import { cheatGate } from '../shelf.js';
const bar = { isGradedBreakout: false, baseGrade: 'A', gradedBreakoutToday: false, liquidityOk: true, volumeOk: true, bullishCandle: true, cleanConsolidation: true, close: 71.67, resistance: 70.75, basePivot: 84.79, baseDepthPct: 22 };

test('cheat gate: a shelf close inside a base that would grade earns an alert', () => {
  const s = cheatGate(bar);
  assert.equal(s?.kind, 'low-cheat'); // 25% up a 22%-deep base
});

test('cheat gate: SWKS 2026-09-02 still does not alert — its 34.6% deep base carries no grade', () => {
  assert.equal(cheatGate({ ...bar, baseGrade: null, baseDepthPct: 34.6 }), null);
});

test('cheat gate: the pivot close, a resolved base, weak volume, a wick, or an illiquid name do not qualify', () => {
  assert.equal(cheatGate({ ...bar, isGradedBreakout: true }), null);
  assert.equal(cheatGate({ ...bar, gradedBreakoutToday: true }), null);
  assert.equal(cheatGate({ ...bar, volumeOk: false }), null);
  assert.equal(cheatGate({ ...bar, close: 70.5 }), null, 'a high through the 20-bar high with a close under it is a poke');
  assert.equal(cheatGate({ ...bar, cleanConsolidation: false }), null, 'no tight shelf, no cheat');
  assert.equal(cheatGate({ ...bar, liquidityOk: false }), null);
});

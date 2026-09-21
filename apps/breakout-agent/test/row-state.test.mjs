import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowState } from '../row-state.js';

test('NET 2026-09-14: emailed graded pivot close, scan prices under the pivot → retest, not "below pivot"', () => {
  const s = rowState({ entryPrice: 332.22, entryResistance: 332.22, streakHigh: 329.5, currentPrice: 323.99, stopLoss: 308.96, baseGrade: 'A', basePivot: 332.22, alertedAt: '2026-09-14T18:15:26Z' });
  assert.equal(s.entryCleared, true);
  assert.equal(s.noEntry, false);
  assert.equal(s.stoppedOut, false);
});

test('a graded row never emailed and never above its pivot is below the pivot', () => {
  const s = rowState({ entryPrice: 100, entryResistance: 100, streakHigh: 96, currentPrice: 95, stopLoss: 93, baseGrade: 'A', basePivot: 100, alertedAt: null });
  assert.equal(s.noEntry, true);
  assert.equal(s.stoppedOut, false, 'no trade to fail');
});

test('a cleared entry that closes at the fail level is stopped out', () => {
  const s = rowState({ entryPrice: 100, entryResistance: 100, streakHigh: 103, currentPrice: 92.5, stopLoss: 93, baseGrade: 'A', basePivot: 100, alertedAt: '2026-09-10T00:00:00Z' });
  assert.equal(s.stoppedOut, true);
});

test('legacy ungraded rows keep the old rule against the frozen entry', () => {
  assert.equal(rowState({ entryPrice: 50, entryResistance: 50, streakHigh: 49, currentPrice: 48, stopLoss: 46.5, baseGrade: null, basePivot: null, alertedAt: null }).noEntry, true);
  assert.equal(rowState({ entryPrice: 50, entryResistance: 50, streakHigh: 50.2, currentPrice: 48, stopLoss: 46.5, baseGrade: null, basePivot: null, alertedAt: null }).noEntry, false);
});

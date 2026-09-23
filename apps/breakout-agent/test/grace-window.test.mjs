// The one-session grace window on a graded breakout, and its price ceiling.
// Pure function, no database. Runs against the compiled agent (npm run build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokeOutNow } from '../dist/tools/market-data.js';

const at = (over = {}) => ({
  breakoutDate: '2026-09-21', latestDate: '2026-09-21', prevDate: '2026-09-18',
  close: 266.06, pivot: 258.35, ...over,
});

test('the breakout bar itself fires at any clearance — the close is the price on offer', () => {
  assert.equal(brokeOutNow(at()), true, '3.0% past the pivot on the day');
  assert.equal(brokeOutNow(at({ close: 320 })), true, '24% past, still the bar that cleared it');
});

test('the session after still fires while price is within 2% of the pivot', () => {
  const graceDay = { latestDate: '2026-09-22', prevDate: '2026-09-21' };
  assert.equal(brokeOutNow(at({ ...graceDay, close: 258.5 })), true, '0.06% past');
  assert.equal(brokeOutNow(at({ ...graceDay, close: 263.5 })), true, '2.0% past, the edge');
  assert.equal(brokeOutNow(at({ ...graceDay, close: 263.52 })), false, 'just over the edge');
});

test('TWLO 2026-09-22: the grace day no longer emails a pivot nobody could get', () => {
  // Breakout 21 Sep at 266.06 on a 258.35 pivot. The next morning the scan saw
  // 279.33, 8.1% past, and mailed an entry of 258.35 with a fail at 240.27.
  const twlo = brokeOutNow({
    breakoutDate: '2026-09-21', latestDate: '2026-09-22', prevDate: '2026-09-21',
    close: 279.33, pivot: 258.35,
  });
  assert.equal(twlo, false);
});

test('a close at or under the pivot is not a breakout on either day', () => {
  assert.equal(brokeOutNow(at({ close: 258.35 })), false);
  assert.equal(brokeOutNow(at({ close: 250, latestDate: '2026-09-22', prevDate: '2026-09-21' })), false);
});

test('an older breakout, a missing date or a missing pivot never fires', () => {
  assert.equal(brokeOutNow(at({ breakoutDate: '2026-09-17', latestDate: '2026-09-22', prevDate: '2026-09-21' })), false, 'two sessions back');
  assert.equal(brokeOutNow(at({ breakoutDate: null })), false);
  assert.equal(brokeOutNow(at({ pivot: 0 })), false);
  assert.equal(brokeOutNow(at({ latestDate: '2026-09-22', prevDate: null })), false, 'no previous session to grace');
});

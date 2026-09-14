// The alert window admits market hours and 45 minutes after the close, so a
// post-close scan can email the settled close the same day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAlertWindow, isMarketOpen } from '../dist/agent.js';

const et = (iso) => new Date(iso); // ISO with explicit -04:00 offset (EDT)
test('open market is inside the window', () => {
  assert.equal(isMarketOpen(et('2026-09-01T15:59:00-04:00')), true);
  assert.equal(isAlertWindow(et('2026-09-01T15:59:00-04:00')), true);
});
test('post-close grace admits the 16:15 pass and closes at 16:45', () => {
  assert.equal(isMarketOpen(et('2026-09-01T16:15:00-04:00')), false);
  assert.equal(isAlertWindow(et('2026-09-01T16:15:00-04:00')), true);
  assert.equal(isAlertWindow(et('2026-09-01T16:45:00-04:00')), true);
  assert.equal(isAlertWindow(et('2026-09-01T16:46:00-04:00')), false);
});
test('weekends and mornings stay closed', () => {
  assert.equal(isAlertWindow(et('2026-09-05T16:15:00-04:00')), false); // Saturday
  assert.equal(isAlertWindow(et('2026-09-01T09:00:00-04:00')), false);
});
test('NSE window is measured in IST', () => {
  assert.equal(isAlertWindow(et('2026-09-01T15:45:00+05:30'), 'IN'), true);
  assert.equal(isAlertWindow(et('2026-09-01T16:20:00+05:30'), 'IN'), false);
});

// Filling a session Yahoo left null. Pure function, no network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeGapBars } from '../candle-gaps.js';

const bar = (time, close) => ({ time, open: close, high: close, low: close, close, volume: 1e6 });

test('TWLO 2026-09-22: Yahoo returned the timestamp with a null close, so the session was dropped', () => {
  // What the fetcher produced: 22 September simply absent between two sessions.
  const yahoo = [bar('2026-09-18', 243.84), bar('2026-09-21', 266.06), bar('2026-09-23', 292.68)];
  const store = [bar('2026-09-18', 243.84), bar('2026-09-21', 266.06), bar('2026-09-22', 285.4)];
  const out = mergeGapBars(yahoo, store);
  assert.deepEqual(out.map((b) => b.time), ['2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23']);
  assert.equal(out[2].close, 285.4, 'the settled bar comes from the store');
  assert.equal(out[3].close, 292.68, "and today's live bar is still Yahoo's");
});

test('the store never extends the window Yahoo returned', () => {
  const yahoo = [bar('2026-09-21', 266.06), bar('2026-09-23', 292.68)];
  const store = [bar('2024-01-02', 60), bar('2026-09-22', 285.4), bar('2026-09-24', 300)];
  const out = mergeGapBars(yahoo, store);
  assert.deepEqual(out.map((b) => b.time), ['2026-09-21', '2026-09-22', '2026-09-23']);
});

test('Yahoo wins any session both sources carry', () => {
  const yahoo = [bar('2026-09-21', 266.06), bar('2026-09-22', 285.4)];
  const store = [bar('2026-09-21', 999), bar('2026-09-22', 999)];
  const out = mergeGapBars(yahoo, store);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((b) => b.close), [266.06, 285.4]);
});

test('no store, no gaps, or nothing at all: the Yahoo series passes through', () => {
  const yahoo = [bar('2026-09-21', 266.06), bar('2026-09-22', 285.4)];
  assert.equal(mergeGapBars(yahoo, []), yahoo);
  assert.equal(mergeGapBars(yahoo, null), yahoo);
  assert.equal(mergeGapBars(yahoo, [bar('2026-09-21', 266.06)]), yahoo, 'a store with no new date is a no-op');
  assert.deepEqual(mergeGapBars([], [bar('2026-09-22', 285.4)]), []);
  assert.deepEqual(mergeGapBars(null, []), []);
});

test('several missing sessions are all filled, in order', () => {
  const yahoo = [bar('2026-09-14', 231), bar('2026-09-18', 243)];
  const store = [bar('2026-09-15', 242), bar('2026-09-16', 238), bar('2026-09-17', 246)];
  const out = mergeGapBars(yahoo, store);
  assert.deepEqual(out.map((b) => b.time), ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
});

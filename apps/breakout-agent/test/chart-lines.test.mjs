// A line the reader drew, and whether a close crossed it. Pure arithmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineValueAt, isLive, crossing, crossingWords } from '../chart-lines.js';

const sec = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000);
// QNT as drawn on 2026-09-26: a falling line from the 86.79 high to 53.45.
const qnt = () => ({ kind: 'segment', t1: sec('2026-07-06'), p1: 86.79, t2: sec('2026-09-26'), p2: 53.45 });

test('a falling trendline keeps falling, so price can rise through it', () => {
  const l = qnt();
  assert.equal(Math.round(lineValueAt(l, l.t1)), 87);
  assert.equal(Math.round(lineValueAt(l, l.t2)), 53);
  const mid = lineValueAt(l, Math.floor((l.t1 + l.t2) / 2));
  assert.ok(mid > 69 && mid < 71, `halfway sits near 70, got ${mid.toFixed(2)}`);
});

test('a crossing is a change of side, not a standing condition', () => {
  // Otherwise a stock above the line since March emails every session.
  const below = { ...qnt(), lastSide: 'below' };
  const up = crossing(below, 55, below.t2);
  assert.equal(up.crossed, true);
  assert.equal(up.from, 'below');
  assert.equal(up.side, 'above');

  const stillAbove = { ...qnt(), lastSide: 'above' };
  assert.equal(crossing(stillAbove, 55, stillAbove.t2).crossed, false);
});

test('the first look records the side and says nothing', () => {
  // We have no idea whether it just got there.
  const fresh = crossing(qnt(), 55, qnt().t2);
  assert.equal(fresh.first, true);
  assert.ok(!fresh.crossed);
  assert.equal(crossingWords('QNT', qnt(), fresh), null, 'and sends no mail');
});

test('a segment stops at its second anchor; a ray does not', () => {
  const l = qnt();
  const later = l.t2 + 30 * 86400;
  assert.equal(isLive(l, later), false);
  assert.equal(crossing({ ...l, lastSide: 'below' }, 55, later), null, 'a finished segment cannot be crossed');
  assert.equal(isLive({ ...l, kind: 'ray' }, later), true);
  assert.equal(crossing({ ...l, kind: 'ray', lastSide: 'below' }, 40, later).crossed, false, 'and the ray keeps falling');
});

test('a vertical line has no price to compare, and sitting on it is not a cross', () => {
  const t = sec('2026-09-26');
  assert.equal(lineValueAt({ t1: t, p1: 10, t2: t, p2: 20 }, t), null);
  const l = qnt();
  assert.equal(crossing({ ...l, lastSide: 'below' }, lineValueAt(l, l.t2), l.t2), null);
});

test('the sentence names it as the reader\'s line, never as a screen signal', () => {
  const l = { ...qnt(), lastSide: 'below' };
  const w = crossingWords('QNT', l, crossing(l, 55, l.t2));
  assert.match(w, /^QNT closed above the line you drew/);
  for (const banned of ['buy', 'breakout', 'signal', 'should', 'entry']) {
    assert.ok(!w.toLowerCase().includes(banned), `no "${banned}" in it`);
  }
  assert.equal(crossingWords('QNT', l, { side: 'above', crossed: false }), null);
});

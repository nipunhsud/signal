// What a breakout does next, from the clearance and the breakout bar's volume.
// Pure lookup over a measured table; no network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdOdds, holdOddsWords } from '../hold-odds.js';

test('HPE 2026-09-25: a 0.1% clear on ordinary volume is the retest corner', () => {
  const o = holdOdds(0.1, 1.2);
  assert.equal(o.likeliest, 'retests');
  assert.equal(o.retests, 61);
  assert.ok(o.n > 40000, 'and it is the best-populated cell in the table');
  // It retested the next session, which is what 61% means.
});

test('a decisive clear on heavy volume is the opposite corner', () => {
  const o = holdOdds(8, 4);
  assert.equal(o.likeliest, 'holds');
  assert.equal(o.holds, 73);
  assert.ok(o.pf > holdOdds(0.1, 1.2).pf, 'and it pays more, 2.47 against 1.60');
});

test('every cell sums to 100 and reports how many it was measured on', () => {
  for (const c of [0.5, 2, 4, 9]) {
    for (const v of [1.1, 2, 5]) {
      const o = holdOdds(c, v);
      assert.ok(o, `${c}% on ${v}x has a cell`);
      const sum = o.holds + o.retests + o.fails;
      assert.ok(Math.abs(sum - 100) <= 1, `${c}%/${v}x sums to ${sum}`);
      assert.ok(o.n > 0 && o.pf > 0);
    }
  }
});

test('clearance dominates, and volume still helps inside a band', () => {
  // Down a column: more clearance, more holding.
  assert.ok(holdOdds(0.5, 2).holds < holdOdds(2, 2).holds);
  assert.ok(holdOdds(2, 2).holds < holdOdds(4, 2).holds);
  assert.ok(holdOdds(4, 2).holds < holdOdds(9, 2).holds);
  // Across a row: more volume, more holding.
  assert.ok(holdOdds(4, 1.1).holds < holdOdds(4, 2).holds);
  assert.ok(holdOdds(4, 2).holds < holdOdds(4, 5).holds);
});

test('a thin cell borrows its row rather than quoting 173 cases', () => {
  const o = holdOdds(9, 1.1);
  assert.equal(o.borrowed, true);
  assert.equal(o.holds, 67, 'the 6%+ row marginal');
});

test('no clear, no odds', () => {
  assert.equal(holdOdds(0, 2), null, 'a close at the pivot has not cleared it');
  assert.equal(holdOdds(-1.5, 2), null, 'nor has one below it');
  assert.equal(holdOdds(2, 0), null, 'and volume is required');
  assert.equal(holdOdds(null, 2), null);
  assert.equal(holdOddsWords(null), null);
});

test('the sentence says the path and the sample, and claims nothing about payoff', () => {
  const w = holdOddsWords(holdOdds(0.1, 1.2));
  assert.match(w, /comes back to the pivot 61% of the time/);
  assert.match(w, /44,332 measured/);
  for (const banned of ['buy', 'entry', 'stop', 'target', 'should']) {
    assert.ok(!w.toLowerCase().includes(banned), `no "${banned}" in a screen sentence`);
  }
});

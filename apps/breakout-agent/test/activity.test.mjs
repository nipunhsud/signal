import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeActivity, activityWords, activityOdds } from '../activity.js';

// 320 quiet bars at 100 with volume 1M, then a tape we control in the last 50.
function tape(edits = []) {
  const bars = [];
  let px = 100;
  for (let k = 0; k < 320; k++) bars.push({ time: `d${k}`, open: px, high: px * 1.005, low: px * 0.995, close: px, volume: 1_000_000 });
  for (const e of edits) {
    const k = 320 - 50 + e.at; // 0..49 inside the window
    const prev = bars[k - 1].close;
    const close = prev * (1 + e.ret);
    bars[k] = { time: `d${k}`, open: prev, high: Math.max(prev, close) * 1.002, low: Math.min(prev, close) * 0.998, close, volume: e.vol };
    for (let j = k + 1; j < 320; j++) { bars[j].open = bars[j].close = close; bars[j].high = close * 1.005; bars[j].low = close * 0.995; }
  }
  return bars;
}

test('a quiet tape scores 0', () => {
  const a = computeActivity(tape(), null);
  assert.deepEqual([a.score, a.acc, a.dist, a.bigUp], [0, 0, 0, 0]);
});

test('accumulation days need a 1% close on 1.5x volume; distribution is the mirror', () => {
  const a = computeActivity(tape([
    { at: 5, ret: 0.012, vol: 1_600_000 }, { at: 10, ret: 0.015, vol: 1_600_000 }, { at: 15, ret: 0.011, vol: 1_600_000 },
    { at: 20, ret: 0.03, vol: 1_400_000 },   // big move, light volume: nothing
    { at: 25, ret: 0.005, vol: 3_000_000 },  // heavy volume, small move: nothing
    { at: 30, ret: -0.02, vol: 2_000_000 },  // distribution
  ]), null);
  assert.equal(a.acc, 3); assert.equal(a.dist, 1);
  assert.equal(a.points.net, 1, 'net 2 → 1 point');
});

test('a print at the high: +2% on 2x volume within 5% of the 52-week high', () => {
  const a = computeActivity(tape([{ at: 40, ret: 0.025, vol: 2_200_000 }]), null);
  assert.equal(a.bigUp, 1); assert.equal(a.acc, 1);
  assert.equal(a.score, 2, '1 net + 1 print');
});

test('base volume tells add points; the words and the odds follow the score', () => {
  const a = computeActivity(tape([{ at: 40, ret: 0.025, vol: 2_200_000 }]), { upDownVolumeRatio: 1.7 });
  assert.equal(a.points.udv, 1);
  assert.equal(a.score, 3);
  assert.match(activityWords(a), /1 heavy up day and 0 heavy down days in the last 50 sessions, 1 print on double volume at the high, up volume 1.7x down volume in the base\. Breakouts with this score reached \+20% 19% of the time historically, profit factor 1\.98\./);
  assert.equal(activityOdds(7).pf, 2.41);
});

test('KNSA-like tape: five heavy up days, none down, two prints → 5', () => {
  const edits = [3, 9, 17, 26, 33].map((at) => ({ at, ret: 0.014, vol: 1_700_000 }));
  edits.push({ at: 41, ret: 0.03, vol: 2_500_000 }, { at: 47, ret: 0.028, vol: 2_400_000 });
  const a = computeActivity(tape(edits), { upDownVolumeRatio: 1.47 });
  assert.equal(a.acc, 7); assert.equal(a.dist, 0); assert.equal(a.bigUp, 2);
  assert.equal(a.score, 5);
});
